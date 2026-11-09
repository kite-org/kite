---
title: Kite Desktop (Beta)
description: Download Kite Desktop for macOS and Windows, connect your kubeconfig, and manage Kubernetes from your computer.
---

# Kite Desktop (Beta)

Kite Desktop brings the Kubernetes workspace to your computer. Browse resources, manage Helm releases, inspect logs, and use the AI assistant without deploying a Kite server or creating a Kite account. Cluster access uses the credentials and Kubernetes permissions in your kubeconfig.

## Download

[Download Kite Desktop from the latest release →](https://github.com/kite-org/kite/releases/latest)

Download the latest desktop package for your platform:

| Platform         | Requirements                           | Package                                                                                                    |
| ---------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| macOS            | Apple Silicon (M1 or later), macOS 13+ | [kite-darwin-arm64.dmg](https://github.com/kite-org/kite/releases/latest/download/kite-darwin-arm64.dmg)   |
| Windows          | x64                                    | [kite-windows-amd64.exe](https://github.com/kite-org/kite/releases/latest/download/kite-windows-amd64.exe) |
| Windows portable | x64                                    | [kite-windows-amd64.zip](https://github.com/kite-org/kite/releases/latest/download/kite-windows-amd64.zip) |

Desktop packages are published alongside Kite releases. If these files are not yet listed, the desktop packages have not been published for that release. The other command-line archives are not desktop installers.

Intel Mac and Linux desktop packages are not currently provided. You can still [self-host Kite](./installation) and use it in a browser.

## Install and connect

1. **macOS:** open the DMG and drag Kite into Applications. **Windows:** run the installer, or extract the portable ZIP and open `Kite.exe`, keeping the included DLL alongside it.
2. Open Kite. It reads your default `~/.kube/config`, or the files in `KUBECONFIG` when that environment variable is available to the app.
3. To connect another configuration, choose or drop a kubeconfig file in the import dialog. Select a cluster to start working.

::: info macOS beta
The current macOS build is not notarized by Apple. If macOS blocks it, follow the system's **Privacy & Security → Open Anyway** flow after verifying that you downloaded it from the official Kite release.
:::

## What the desktop app adds

- **Live kubeconfig sync.** Changes to linked files update credentials and add or remove contexts, including after restarting Kite. Pasting YAML creates a one-time import instead.
- **Independent windows.** Keep Pod logs, terminals, a local kubectl terminal, or an AI conversation open while navigating the main workspace. Install `kubectl` locally to use the local kubectl terminal.
- **Local port forwarding.** Forward a Pod or Service port to your computer. Manage connections from the toolbar or the menu bar / system tray. Connections stay active as you navigate and stop when you quit Kite.

Manage linked kubeconfig files in **Settings → Clusters**. Removing a source stops synchronization and removes its connections from Kite; it does not delete the original file or Kubernetes resources. If a file becomes unreadable or invalid, Kite keeps the last valid configuration and shows the error in settings.

## Cloud authentication

If your kubeconfig uses an `exec` authentication helper, that command must be installed and authenticated on the same computer. Kite uses the helper referenced by your kubeconfig; it does not bundle AWS CLI, Google Cloud CLI, or other provider tools.

On macOS, Kite also looks in the usual Homebrew locations, `~/.krew/bin`, and `~/.local/bin`. For tools installed elsewhere, use an absolute executable path in your kubeconfig or make the command available in the app's `PATH`. A command that works only through your terminal's shell setup may not be available when Kite starts from Finder.

Cloud authentication flows are still being validated during beta. If a connection fails, check the helper's installation, executable path, and login state on your computer.

## Desktop or self-hosted?

Use Desktop for your own local workspace and existing cluster credentials. For a shared web console with Kite accounts, centralized authentication, and team access management, follow the [self-hosted installation guide](./installation).
