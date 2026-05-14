# ClickUp Browser Executor

Small HTTP service that performs authenticated ClickUp UI automation for `clickup_agent_ref` in remote environments.

Use this when:

- Bizbox runs on one machine
- the real authenticated ClickUp browser session must run on another machine
- `clickup_agent_ref` is configured with `triggerMode=ui_assign_task_remote`

## Endpoint

`POST /clickup/assign-task`

Expected request body:

```json
{
  "action": "clickup.assign_task",
  "taskUrl": "https://app.clickup.com/t/86d2vykxe",
  "clickupAgentName": "Risk Witherspoon",
  "timeoutSec": 1800,
  "browserHeadless": true,
  "browserUserDataDir": "/srv/clickup-browser-profile",
  "browserExecutablePath": "/usr/bin/google-chrome"
}
```

## Environment

- `CLICKUP_BROWSER_EXECUTOR_BIND_ADDR`
  - default: `127.0.0.1:8787`
- `CLICKUP_BROWSER_EXECUTOR_API_KEY`
  - optional bearer token expected on inbound requests
- `CLICKUP_BROWSER_EXECUTOR_USER_DATA_DIR`
  - default browser profile directory if request does not provide one
- `CLICKUP_BROWSER_EXECUTOR_BROWSER_PATH`
  - optional Chrome/Chromium executable path
- `CLICKUP_BROWSER_EXECUTOR_HEADLESS`
  - default: `true`
- `CLICKUP_BROWSER_EXECUTOR_TIMEOUT_SEC`
  - default: `90`
- `CLICKUP_BROWSER_EXECUTOR_MAX_CONCURRENT_SESSIONS`
  - default: `2`

## Local run

```sh
cd cmd/clickup-browser-executor
go build ./...
go run .
```

## Bootstrap login

Use bootstrap mode to open a visible browser window with the persistent profile so you can sign into ClickUp once:

```sh
cd cmd/clickup-browser-executor
CLICKUP_BROWSER_EXECUTOR_USER_DATA_DIR=/private/tmp/clickup-playwright-profile \
CLICKUP_BROWSER_EXECUTOR_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
go run . bootstrap-login --url https://app.clickup.com/t/86d2vykxe
```

What it does:

- launches Chrome or Chromium visibly
- reuses the exact user-data-dir that the executor will use later
- opens the target ClickUp page for manual login
- keeps the process attached until you close the browser or press `Ctrl+C`

## Production expectation

The remote machine must already have:

- Chrome or Chromium installed
- a persistent browser profile that is logged into ClickUp
- network access to `app.clickup.com`

Do not commit platform-specific binaries from this directory. Build the executor from source on the target machine or in CI using `go build ./...`.
