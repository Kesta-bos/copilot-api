# Copilot API

⚠️ **EDUCATIONAL PURPOSE ONLY** ⚠️
This project is a reverse-engineered implementation of the GitHub Copilot API created for educational purposes only. It is not officially supported by GitHub and should not be used in production environments.

## Project Overview

A wrapper around GitHub Copilot API to make it OpenAI compatible, making it usable for other tools.

**Note:** Image/vision capabilities are now supported (experimental) but only work with the gpt-4o model, despite other models showing vision support in their metadata. See [Vision, agent mode, next edit suggestions, and more for GitHub Copilot in VS Code January release (v0.24)](https://github.blog/changelog/2025-02-06-next-edit-suggestions-agent-mode-and-prompts-files-for-github-copilot-in-vs-code-january-release-v0-24/)

## Demo

https://github.com/user-attachments/assets/7654b383-669d-4eb9-b23c-06d7aefee8c5

## Prerequisites

- Bun (>= 1.2.x)
- GitHub account with Copilot Individual subscription

## Installation

To install dependencies, run:

```sh
bun install
```

## Using with npx

You can run the project directly using npx:

```sh
npx copilot-api@latest
```

With options:

```sh
npx copilot-api --port 8080 --emulate-streaming
```

## Running from Source

The project can be run from source in several ways:

### Development Mode

```sh
bun run dev
```

Starts the server with hot reloading enabled, which automatically restarts the server when code changes are detected. This is ideal for development.

### Production Mode

```sh
bun run start
```

Runs the server in production mode with hot reloading disabled. Use this for deployment or production environments.

### Command Line Options

The server accepts several command line options:

| Option              | Description                                                    | Default |
| ------------------- | -------------------------------------------------------------- | ------- |
| --help, -h          | Show help message                                              | false   |
| --emulate-streaming | Enable streaming response emulation                            | false   |
| --port, -p          | Port to listen on                                              | 4141    |
| --logs              | Write logs to the app directory (requires --emulate-streaming) | false   |

Example with options:

```sh
bun run start --port 8080 --emulate-streaming
```

In all cases, the server will start and listen for API requests on the specified port.

## Tested Tools Compatibility

| Tool                                                             | Status  | Notes                                                                                                                                                            |
| ---------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Cline](https://github.com/cline/cline)                          | Partial | Works with GPT-4o. Not compatible with Claude 3.5 Sonnet (prompts are too long - GitHub limits context length to 90K tokens, see `/models` endpoint for details) |
| [Aider](https://github.com/Aider-AI/aider)                       | Full    | Fully compatible                                                                                                                                                 |
| [bolt.diy](https://github.com/stackblitz-labs/bolt.diy)          | Full    | Sometimes models fail to load - you can set any random API key in the UI to refresh the models list                                                              |
| [Page Assist](https://github.com/n4ze3m/page-assist)             | Full    | Fully compatible                                                                                                                                                 |
| [Kobold AI Lite](https://github.com/LostRuins/lite.koboldai.net) | Partial | Won't work if the prompt is too long, because GitHub limits the context length (see `/models` endpoint for more details)                                         |

**Note:** In general, any application that uses the `/chat/completions` and `/models` endpoints should work with this API. The main limitation is the context length imposed by GitHub - if prompts are too long, they may fail.
