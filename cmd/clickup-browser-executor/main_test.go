package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAuthorizeRequest(t *testing.T) {
	t.Run("accepts matching bearer token", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/clickup/assign-task", nil)
		req.Header.Set("Authorization", "Bearer secret")
		if err := authorizeRequest("secret", req); err != nil {
			t.Fatalf("authorizeRequest returned error: %v", err)
		}
	})

	t.Run("rejects missing token", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/clickup/assign-task", nil)
		if err := authorizeRequest("secret", req); err == nil {
			t.Fatalf("expected authorization error")
		}
	})
}

func TestDecodeAssignTaskRequest(t *testing.T) {
	body := `{"action":"clickup.assign_task","taskUrl":"https://app.clickup.com/t/123","clickupAgentName":"Risk Witherspoon"}`
	req := httptest.NewRequest("POST", "/clickup/assign-task", strings.NewReader(body))
	parsed, err := decodeAssignTaskRequest(req)
	if err != nil {
		t.Fatalf("decodeAssignTaskRequest returned error: %v", err)
	}
	if parsed.Action != "clickup.assign_task" {
		t.Fatalf("unexpected action: %s", parsed.Action)
	}
}

func TestResolveExecutionConfig(t *testing.T) {
	cfg := serverConfig{
		defaultUserDataDir: "/srv/profile",
		defaultHeadless:    true,
		defaultTimeout:     90 * time.Second,
	}

	execCfg, err := resolveExecutionConfig(cfg, assignTaskRequest{
		Action:           "clickup.assign_task",
		TaskURL:          "https://app.clickup.com/t/123",
		ClickUpAgentName: "Risk Witherspoon",
	})
	if err != nil {
		t.Fatalf("resolveExecutionConfig returned error: %v", err)
	}
	if execCfg.userDataDir != "/srv/profile" {
		t.Fatalf("expected default user data dir, got %q", execCfg.userDataDir)
	}
	if !execCfg.headless {
		t.Fatalf("expected default headless=true")
	}
}

func TestResolveExecutionConfigRejectsRemoteHTTP(t *testing.T) {
	cfg := serverConfig{
		defaultUserDataDir: "/srv/profile",
		defaultHeadless:    true,
		defaultTimeout:     90 * time.Second,
	}
	_, err := resolveExecutionConfig(cfg, assignTaskRequest{
		Action:           "clickup.assign_task",
		TaskURL:          "http://example.com/task/123",
		ClickUpAgentName: "Risk Witherspoon",
	})
	if err == nil {
		t.Fatalf("expected error for plaintext remote URL")
	}
}

func TestResolveBrowserExecutablePathPrefersExplicitValue(t *testing.T) {
	got := resolveBrowserExecutablePath("/tmp/custom-browser")
	if got != "/tmp/custom-browser" {
		t.Fatalf("expected explicit path to win, got %q", got)
	}
}
