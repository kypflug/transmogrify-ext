# Transmogrifier Cloud API

Azure Functions backend that processes transmogrification jobs asynchronously. This lets you queue a URL for transmogrification and walk away — the result lands in your OneDrive `articles/` folder and syncs to all your devices.

## Architecture

```
POST /api/queue  →  Azure Storage Queue  →  Queue-trigger Function
                                                ├─ Fetch & extract page
                                                ├─ Call AI provider
                                                └─ Upload to user's OneDrive
```

The extension (or PWA) sends a single HTTP request with the URL, recipe, and a OneDrive access token. The API validates the token, enqueues a job, and returns `202 Accepted` immediately. A queue-triggered function picks up the job, does all the heavy lifting, and writes the finished article directly to the user's OneDrive app folder.

## Endpoints

### `POST /api/queue`
Queue a URL for transmogrification.

**Request body:**
```json
{
  "url": "https://example.com/article",
  "recipeId": "focus",
  "accessToken": "<user's Microsoft Graph access token>",
  "aiConfig": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "gpt-4o"
  },
  "customPrompt": "(optional) custom instructions"
}
```

> **BYOK**: The `aiConfig` field is **required**. The cloud function has no server-side AI keys — the caller always supplies their own credentials.

**Response:** `202 Accepted`
```json
{
  "jobId": "abc123",
  "message": "Queued for transmogrification"
}
```

### `POST /api/share`
Create a short link for a shared article.

**Request body:**
```json
{
  "blobUrl": "https://myaccount.blob.core.windows.net/articles/article123.html",
  "title": "My Article",
  "accessToken": "<user's Microsoft Graph access token>",
  "expiresAt": 1739232000000
}
```

**Response:** `200 OK`
```json
{
  "shortCode": "a1b2c3d4e5",
  "shareUrl": "https://transmogrifia.app/shared/a1b2c3d4e5"
}
```

### `DELETE /api/share?code=a1b2c3d4e5`
Remove a shared link. Requires `Authorization: Bearer <token>` header. Only the original creator can delete.

### `GET /api/s/{code}`
Resolve a short code to the blob URL. Public — no authentication required.

**Response:** `200 OK`
```json
{
  "url": "https://myaccount.blob.core.windows.net/articles/article123.html",
  "title": "My Article"
}
```

Returns `404` for expired or non-existent links.

### `GET /api/queue?jobId=abc123`
Check job status (optional — most users just wait for sync).

**Response:**
```json
{
  "jobId": "abc123",
  "status": "complete",
  "articleId": "article_1707500000_abc1234"
}
```

## Setup

### Prerequisites
- Node.js 20+
- Azure Functions Core Tools v4
- Azure Storage account (or Azurite for local dev)
- *No AI API keys needed on the server* — the function uses keys provided by the caller (BYOK)

### Local Development

```bash
cd cloud
npm install

# Copy and configure settings
cp local.settings.example.json local.settings.json
# Edit local.settings.json — only infrastructure settings needed (no AI keys)

# Start Azurite (local storage emulator) in another terminal
azurite --silent

# Start the function app
npm start
```

> **Note:** No AI provider keys are needed in `local.settings.json`. The cloud function receives AI credentials from the client in every request (`aiConfig` field). See `local.settings.example.json` for the minimal required settings.

### Deploy to Azure

```bash
# Create resources
az group create -n transmogrifier-rg -l westus2
az storage account create -n transmogstorage -g transmogrifier-rg -l westus2 --sku Standard_LRS
az functionapp create -n transmogrifier-api -g transmogrifier-rg -l westus2 \
  --runtime node --runtime-version 20 \
  --storage-account transmogstorage \
  --consumption-plan-location westus2

# Configure CORS (required for PWA — extensions bypass CORS)
az functionapp cors add -n transmogrifier-api -g transmogrifier-rg --allowed-origins 'https://transmogrifia.app' 'http://localhost:5173'

# (Optional) Add Application Insights for error visibility
az monitor app-insights component create --app transmogrifier-insights -l westus2 -g transmogrifier-rg
# Copy the connectionString from the output, then:
az functionapp config appsettings set -n transmogrifier-api -g transmogrifier-rg --settings \
  "APPLICATIONINSIGHTS_CONNECTION_STRING=<connection-string>"

# Deploy
npm run build
npm prune --omit=dev   # Shrink deployment size
func azure functionapp publish transmogrifier-api
```

> **BYOK architecture**: The function app needs no AI provider keys. All AI credentials come from the client (extension or PWA) in every request.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AzureWebJobsStorage` | Azure Storage connection string (or `UseDevelopmentStorage=true` for local) |
| `FUNCTIONS_WORKER_RUNTIME` | Must be `node` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | (Optional) Application Insights connection string for error logging |

> The `sharedlinks` Azure Table is automatically used from the same `AzureWebJobsStorage` account for the URL shortener registry.

> AI provider keys (`AI_PROVIDER`, `*_API_KEY`, etc.) are **not** configured on the server. The extension sends the user's own keys in every request via the `aiConfig` field.

### Runtime Configuration

`host.json` sets `functionTimeout` to **10 minutes** (maximum for Consumption plan). AI generation with large articles and high `max_tokens` can take several minutes, so the default 5-minute timeout is insufficient.

## How Sync Works

1. User queues a URL from extension popup or PWA
2. Cloud function processes it and writes `{id}.html` + `{id}.json` to the user's OneDrive `approot/articles/` folder
3. Extension's periodic sync (every 5 min) picks up new articles via delta query
4. Article appears in the library automatically

No changes to the existing sync protocol are needed — the cloud function writes in the exact same format as the extension's `pushArticleToCloud`.
