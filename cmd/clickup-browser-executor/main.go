package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/chromedp/chromedp"
)

const (
	defaultBindAddr              = "127.0.0.1:8787"
	maxBodyBytes                 = 1 << 20
	defaultMaxConcurrentSessions = 2
)

var candidateBrowserPaths = []string{
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
}

type serverConfig struct {
	bindAddr              string
	apiKey                string
	defaultUserDataDir    string
	defaultExecutablePath string
	defaultHeadless       bool
	defaultTimeout        time.Duration
	maxConcurrentSessions int
	sessionSlots          chan struct{}
}

type assignTaskRequest struct {
	Action                string `json:"action"`
	TaskURL               string `json:"taskUrl"`
	ClickUpAgentName      string `json:"clickupAgentName"`
	TimeoutSec            int    `json:"timeoutSec"`
	BrowserHeadless       *bool  `json:"browserHeadless,omitempty"`
	BrowserUserDataDir    string `json:"browserUserDataDir,omitempty"`
	BrowserExecutablePath string `json:"browserExecutablePath,omitempty"`
}

type errorResponse struct {
	Error string `json:"error"`
}

type okResponse struct {
	OK        bool   `json:"ok"`
	Action    string `json:"action"`
	TaskURL   string `json:"taskUrl"`
	AgentName string `json:"clickupAgentName"`
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	if len(os.Args) > 1 && os.Args[1] == "bootstrap-login" {
		if err := runBootstrapLogin(cfg, os.Args[2:]); err != nil {
			log.Fatalf("bootstrap-login error: %v", err)
		}
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/clickup/assign-task", withConfig(cfg, handleAssignTask))

	srv := &http.Server{
		Addr:              cfg.bindAddr,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdownCtx.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		log.Printf("shutdown signal received; draining clickup-browser-executor")
		if err := srv.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("shutdown error: %v", err)
		}
	}()

	log.Printf("clickup-browser-executor listening on http://%s", cfg.bindAddr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server error: %v", err)
	}
}

func runBootstrapLogin(cfg serverConfig, args []string) error {
	fs := flag.NewFlagSet("bootstrap-login", flag.ContinueOnError)
	urlFlag := fs.String("url", "https://app.clickup.com", "URL to open for manual ClickUp login")
	userDataDirFlag := fs.String("user-data-dir", cfg.defaultUserDataDir, "Chrome/Chromium user data directory")
	browserPathFlag := fs.String("browser-path", cfg.defaultExecutablePath, "Chrome/Chromium executable path")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*userDataDirFlag) == "" {
		return errors.New("bootstrap-login requires --user-data-dir or CLICKUP_BROWSER_EXECUTOR_USER_DATA_DIR")
	}
	targetURL := strings.TrimSpace(*urlFlag)
	if targetURL == "" {
		targetURL = "https://app.clickup.com"
	}
	parsed, err := url.Parse(targetURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("invalid bootstrap URL: %s", targetURL)
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopback(parsed.Hostname())) {
		return errors.New("bootstrap URL must use https for remote hosts")
	}

	browserPath := strings.TrimSpace(*browserPathFlag)
	if browserPath == "" {
		browserPath = resolveBrowserExecutablePath("")
	}
	if browserPath == "" {
		return errors.New("could not resolve a browser executable; pass --browser-path or set CLICKUP_BROWSER_EXECUTOR_BROWSER_PATH")
	}

	if err := os.MkdirAll(*userDataDirFlag, 0o755); err != nil {
		return fmt.Errorf("create user-data-dir: %w", err)
	}

	cmd := exec.Command(browserPath,
		"--user-data-dir="+*userDataDirFlag,
		"--new-window",
		targetURL,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	log.Printf("launching browser for ClickUp login")
	log.Printf("browser: %s", browserPath)
	log.Printf("profile: %s", *userDataDirFlag)
	log.Printf("url: %s", targetURL)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start browser: %w", err)
	}

	log.Printf("complete the ClickUp login in the opened browser window, then close the window or press Ctrl+C here")
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigCh)

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("browser exited with error: %w", err)
		}
		log.Printf("browser exited cleanly")
		return nil
	case sig := <-sigCh:
		log.Printf("received %s, stopping bootstrap-login", sig)
		if cmd.Process != nil {
			_ = cmd.Process.Signal(os.Interrupt)
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				_ = cmd.Process.Kill()
				<-done
			}
		}
		return nil
	}
}

func loadConfig() (serverConfig, error) {
	bindAddr := strings.TrimSpace(os.Getenv("CLICKUP_BROWSER_EXECUTOR_BIND_ADDR"))
	if bindAddr == "" {
		bindAddr = defaultBindAddr
	}
	if _, _, err := net.SplitHostPort(bindAddr); err != nil {
		return serverConfig{}, fmt.Errorf("invalid CLICKUP_BROWSER_EXECUTOR_BIND_ADDR: %w", err)
	}

	timeout := 90 * time.Second
	if raw := strings.TrimSpace(os.Getenv("CLICKUP_BROWSER_EXECUTOR_TIMEOUT_SEC")); raw != "" {
		parsed, err := time.ParseDuration(raw + "s")
		if err != nil {
			return serverConfig{}, fmt.Errorf("invalid CLICKUP_BROWSER_EXECUTOR_TIMEOUT_SEC: %w", err)
		}
		timeout = parsed
	}

	maxConcurrentSessions := defaultMaxConcurrentSessions
	if raw := strings.TrimSpace(os.Getenv("CLICKUP_BROWSER_EXECUTOR_MAX_CONCURRENT_SESSIONS")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			return serverConfig{}, errors.New("invalid CLICKUP_BROWSER_EXECUTOR_MAX_CONCURRENT_SESSIONS")
		}
		maxConcurrentSessions = parsed
	}

	return serverConfig{
		bindAddr:              bindAddr,
		apiKey:                strings.TrimSpace(os.Getenv("CLICKUP_BROWSER_EXECUTOR_API_KEY")),
		defaultUserDataDir:    strings.TrimSpace(os.Getenv("CLICKUP_BROWSER_EXECUTOR_USER_DATA_DIR")),
		defaultExecutablePath: strings.TrimSpace(os.Getenv("CLICKUP_BROWSER_EXECUTOR_BROWSER_PATH")),
		defaultHeadless:       parseBoolEnv("CLICKUP_BROWSER_EXECUTOR_HEADLESS", true),
		defaultTimeout:        timeout,
		maxConcurrentSessions: maxConcurrentSessions,
		sessionSlots:          make(chan struct{}, maxConcurrentSessions),
	}, nil
}

func parseBoolEnv(key string, fallback bool) bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	switch raw {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func withConfig(cfg serverConfig, next func(serverConfig, http.ResponseWriter, *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		next(cfg, w, r)
	}
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func handleAssignTask(cfg serverConfig, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method_not_allowed"})
		return
	}
	if err := authorizeRequest(cfg.apiKey, r); err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: err.Error()})
		return
	}

	req, err := decodeAssignTaskRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error()})
		return
	}

	execCfg, err := resolveExecutionConfig(cfg, req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error()})
		return
	}

	release, err := acquireExecutionSlot(r.Context(), cfg.sessionSlots)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: err.Error()})
		return
	}
	defer release()

	if err := assignClickUpTask(r.Context(), execCfg); err != nil {
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, okResponse{
		OK:        true,
		Action:    req.Action,
		TaskURL:   req.TaskURL,
		AgentName: req.ClickUpAgentName,
	})
}

func acquireExecutionSlot(ctx context.Context, slots chan struct{}) (func(), error) {
	if slots == nil {
		return func() {}, nil
	}
	select {
	case slots <- struct{}{}:
		return func() {
			<-slots
		}, nil
	case <-ctx.Done():
		return nil, errors.New("request_cancelled")
	default:
		return nil, errors.New("executor_busy")
	}
}

func authorizeRequest(apiKey string, r *http.Request) error {
	if apiKey == "" {
		return nil
	}
	authz := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(strings.ToLower(authz), "bearer ") {
		return errors.New("missing_bearer_token")
	}
	token := strings.TrimSpace(authz[len("Bearer "):])
	if subtle.ConstantTimeCompare([]byte(token), []byte(apiKey)) != 1 {
		return errors.New("invalid_bearer_token")
	}
	return nil
}

func decodeAssignTaskRequest(r *http.Request) (assignTaskRequest, error) {
	r.Body = io.NopCloser(io.LimitReader(r.Body, maxBodyBytes))
	defer r.Body.Close()

	var req assignTaskRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return assignTaskRequest{}, fmt.Errorf("invalid_json: %w", err)
	}
	if req.Action != "clickup.assign_task" {
		return assignTaskRequest{}, errors.New("unsupported_action")
	}
	if strings.TrimSpace(req.TaskURL) == "" {
		return assignTaskRequest{}, errors.New("taskUrl is required")
	}
	if strings.TrimSpace(req.ClickUpAgentName) == "" {
		return assignTaskRequest{}, errors.New("clickupAgentName is required")
	}
	return req, nil
}

type executionConfig struct {
	taskURL        string
	agentName      string
	userDataDir    string
	executablePath string
	headless       bool
	timeout        time.Duration
}

func resolveExecutionConfig(cfg serverConfig, req assignTaskRequest) (executionConfig, error) {
	taskURL := strings.TrimSpace(req.TaskURL)
	parsedURL, err := url.Parse(taskURL)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return executionConfig{}, errors.New("taskUrl must be an absolute URL")
	}
	if parsedURL.Scheme != "https" && !(parsedURL.Scheme == "http" && isLoopback(parsedURL.Hostname())) {
		return executionConfig{}, errors.New("taskUrl must use https for remote hosts")
	}

	timeout := cfg.defaultTimeout
	if req.TimeoutSec > 0 {
		timeout = time.Duration(req.TimeoutSec) * time.Second
	}

	userDataDir := strings.TrimSpace(req.BrowserUserDataDir)
	if userDataDir == "" {
		userDataDir = cfg.defaultUserDataDir
	}
	if userDataDir == "" {
		return executionConfig{}, errors.New("browserUserDataDir is required")
	}

	executablePath := strings.TrimSpace(req.BrowserExecutablePath)
	if executablePath == "" {
		executablePath = cfg.defaultExecutablePath
	}

	headless := cfg.defaultHeadless
	if req.BrowserHeadless != nil {
		headless = *req.BrowserHeadless
	}

	return executionConfig{
		taskURL:        taskURL,
		agentName:      strings.TrimSpace(req.ClickUpAgentName),
		userDataDir:    userDataDir,
		executablePath: executablePath,
		headless:       headless,
		timeout:        timeout,
	}, nil
}

func isLoopback(hostname string) bool {
	return hostname == "localhost" || hostname == "127.0.0.1" || hostname == "::1"
}

func resolveBrowserExecutablePath(explicitPath string) string {
	trimmed := strings.TrimSpace(explicitPath)
	if trimmed != "" {
		return trimmed
	}
	for _, candidate := range candidateBrowserPaths {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

func assignClickUpTask(parent context.Context, cfg executionConfig) error {
	ctx, cancel := context.WithTimeout(parent, cfg.timeout)
	defer cancel()

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.UserDataDir(cfg.userDataDir),
		chromedp.Flag("headless", cfg.headless),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-first-run", true),
		chromedp.Flag("no-default-browser-check", true),
	)
	if cfg.executablePath != "" {
		opts = append(opts, chromedp.ExecPath(cfg.executablePath))
	}

	allocCtx, allocCancel := chromedp.NewExecAllocator(ctx, opts...)
	defer allocCancel()
	taskCtx, taskCancel := chromedp.NewContext(allocCtx)
	defer taskCancel()

	if err := chromedp.Run(taskCtx,
		chromedp.Navigate(cfg.taskURL),
		chromedp.Sleep(2*time.Second),
	); err != nil {
		return fmt.Errorf("failed to open task URL: %w", err)
	}

	var currentURL string
	if err := chromedp.Run(taskCtx, chromedp.Location(&currentURL)); err != nil {
		return fmt.Errorf("failed to inspect current URL: %w", err)
	}
	lowerURL := strings.ToLower(currentURL)
	if strings.Contains(lowerURL, "/login") || strings.Contains(lowerURL, "signin") {
		return errors.New("clickup browser session is not authenticated")
	}

	if err := chromedp.Run(taskCtx, chromedp.Evaluate(clickAssigneeControlJS, nil)); err != nil {
		return fmt.Errorf("failed to open assignee picker: %w", err)
	}
	if err := chromedp.Run(taskCtx,
		chromedp.Sleep(700*time.Millisecond),
		chromedp.Evaluate(fillAssigneeSearchJS(cfg.agentName), nil),
		chromedp.Sleep(900*time.Millisecond),
		chromedp.Evaluate(selectAssigneeOptionJS(cfg.agentName), nil),
	); err != nil {
		return fmt.Errorf("failed to assign ClickUp AI agent '%s': %w", cfg.agentName, err)
	}

	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Truncate(time.Millisecond))
	})
}

const clickAssigneeControlJS = `(function () {
  const match = /assign|assignee/i;
  const candidates = Array.from(document.querySelectorAll('button,[role="button"],[aria-label]'));
  for (const el of candidates) {
    const label = [el.innerText || '', el.getAttribute('aria-label') || '', el.getAttribute('data-testid') || '', el.getAttribute('data-test') || ''].join(' ');
    if (match.test(label)) {
      el.click();
      return true;
    }
  }
  throw new Error('Could not locate the ClickUp assignee control.');
})()`

func fillAssigneeSearchJS(agentName string) string {
	return fmt.Sprintf(`(function () {
  const agentName = %q;
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  const assignValue = (el, value) => {
    if (valueSetter && el instanceof HTMLInputElement) {
      valueSetter.call(el, value);
      return;
    }
    el.value = value;
  };
  const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), textarea'));
  for (const el of inputs) {
    const text = ((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
    if (text.includes('search') || text.includes('assign')) {
      el.focus();
      assignValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      assignValue(el, agentName);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  const fallback = inputs[0];
  if (!fallback) throw new Error('Could not locate the assignee search input.');
  fallback.focus();
  assignValue(fallback, '');
  fallback.dispatchEvent(new Event('input', { bubbles: true }));
  assignValue(fallback, agentName);
  fallback.dispatchEvent(new Event('input', { bubbles: true }));
  fallback.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`, agentName)
}

func selectAssigneeOptionJS(agentName string) string {
	return fmt.Sprintf(`(function () {
  const agentName = %q.toLowerCase();
  const candidates = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], button, div, span'));
  for (const el of candidates) {
    const text = (el.innerText || '').trim().toLowerCase();
    if (text && text.includes(agentName)) {
      el.click();
      return true;
    }
  }
  throw new Error('Could not find assignee option for ' + %q + '.');
})()`, agentName, agentName)
}
