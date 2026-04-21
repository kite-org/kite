# Makefile for Kite project
.PHONY: help dev build clean test docker-build docker-run frontend backend install deps e2e-install e2e-kind-up e2e-kind-down e2e-stop-app e2e-setup-ldap e2e-setup-dex e2e-test e2e-test-headed

# Variables
BINARY_NAME=kite
UI_DIR=ui
E2E_DIR=e2e
DOCKER_IMAGE=kite
DOCKER_TAG=latest
E2E_KIND_NAME ?= kite-e2e
E2E_PORT ?= 38080
E2E_KUBECONFIG ?= $(shell printf '%s' "$${TMPDIR:-/tmp/}kite-e2e.kubeconfig")
E2E_AUTH_NETWORK ?= kite-e2e-auth
E2E_LDAP_CONTAINER ?= kite-e2e-ldap
E2E_LDAP_PORT ?= 3389
E2E_DEX_CONTAINER ?= kite-e2e-dex
E2E_OAUTH_PORT ?= 5556
SPEC ?=

# Version information
VERSION=$(shell scripts/get-version.sh)
BUILD_DATE ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
COMMIT_ID ?= $(shell git rev-parse HEAD 2>/dev/null || echo "unknown")

# Build flags
LDFLAGS=-ldflags "-s -w \
	-X 'github.com/zxh326/kite/pkg/version.Version=$(VERSION)' \
	-X 'github.com/zxh326/kite/pkg/version.BuildDate=$(BUILD_DATE)' \
	-X 'github.com/zxh326/kite/pkg/version.CommitID=$(COMMIT_ID)'"

# Default target
.DEFAULT_GOAL := build
DOCKER_TAG=latest

LOCALBIN ?= $(shell pwd)/bin
$(LOCALBIN):
	mkdir -p $(LOCALBIN)
GOLANGCI_LINT = $(LOCALBIN)/golangci-lint

# Help target
help: ## Show this help message
	@echo "Available targets:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Install dependencies
install: deps ## Install all dependencies
	@echo "📦 Installing dependencies..."

deps: ## Install frontend and backend dependencies
	@echo "📦 Installing frontend dependencies..."
	cd $(UI_DIR) && pnpm install
	@echo "📦 Installing backend dependencies..."
	go mod download

# Build targets
build: frontend backend ## Build both frontend and backend
	@echo "✅ Build completed successfully!"
	@echo "🚀 Run './$(BINARY_NAME)' to start the server"

clean-frontend: ## Clean frontend build artifacts
	cd $(UI_DIR) && rm -rf dist node_modules/.vite
	rm -rf static

clean-backend: ## Clean backend build artifacts
	rm -rf $(BINARY_NAME) bin/

clean: clean-frontend clean-backend ## Clean all build artifacts
	@echo "🧹 All build artifacts cleaned!"

cross-compile: frontend ## Cross-compile for multiple architectures
	@echo "🔄 Cross-compiling for multiple architectures..."
	mkdir -p bin
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath $(LDFLAGS) -o bin/$(BINARY_NAME)-amd64 .
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath $(LDFLAGS) -o bin/$(BINARY_NAME)-arm64 .
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -trimpath $(LDFLAGS) -o bin/$(BINARY_NAME)-darwin-arm64 .
	# GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -trimpath $(LDFLAGS) -o bin/$(BINARY_NAME)-darwin-amd64 .

package-release:
	@echo "🔄 Packaging..."
	tar -czvf bin/$(BINARY_NAME)-$(shell git describe --tags --match 'v*' | grep -oE 'v[0-9]+\.[0-9][0-9]*(\.[0-9]+)?').tar.gz bin/*

package-binaries: ## Package each kite binary file separately
	@echo "🔄 Packaging kite binaries separately..."
	@VERSION=$$(git describe --tags --match 'v*' | grep -oE 'v[0-9]+\.[0-9][0-9]*(\.[0-9]+)?'); \
	for file in bin/kite-*; do \
		if [ -f "$$file" ]; then \
			filename=$$(basename "$$file"); \
			echo "📦 Packaging $$filename with version $$VERSION..."; \
			tar -czvf "bin/$$filename-$$VERSION.tar.gz" "$$file"; \
		fi; \
	done
	@echo "✅ All kite binaries packaged successfully!"

frontend: static ## Build frontend only

static: ui/src/**/*.tsx ui/src/**/*.ts ui/index.html ui/**/*.css ui/package.json ui/vite.config.ts
	@echo "📦 Ensuring static files are built..."
	cd $(UI_DIR) && pnpm run build

backend: ${BINARY_NAME} ## Build backend only

$(BINARY_NAME): main.go pkg/**/*.go go.mod static
	@echo "🏗️ Building backend..."
	CGO_ENABLED=0 go build -trimpath $(LDFLAGS) -o $(BINARY_NAME) .

# Production targets
run: backend ## Run the built application
	@echo "🚀 Starting $(BINARY_NAME) server..."
	./$(BINARY_NAME)

dev: ## Run in development mode
	@echo "🔄 Starting development mode..."
	@echo "🚀 Starting $(BINARY_NAME) server..."
	CGO_ENABLED=0 go build -trimpath $(LDFLAGS) -o $(BINARY_NAME) .
	./$(BINARY_NAME) -v=5 & \
	BACKEND_PID=$$!; \
	echo "Backend PID: $$BACKEND_PID"; \
	trap 'echo "🛑 Stopping backend server..."; kill $$BACKEND_PID 2>/dev/null; exit' INT TERM; \
	echo "🔄 Starting development server..."; \
	cd $(UI_DIR) && pnpm run dev; \
	echo "🛑 Stopping backend server..."; \
	kill $$BACKEND_PID 2>/dev/null

lint: golangci-lint ## Run linters
	@echo "🔍 Running linters..."
	@echo "Backend linting..."
	go vet ./...
	$(GOLANGCI_LINT) run
	@echo "Frontend linting..."
	cd $(UI_DIR) && pnpm run lint

golangci-lint: ## Download golangci-lint locally if necessary.
	test -f $(GOLANGCI_LINT) || curl -sSfL https://golangci-lint.run/install.sh | sh -s v2.11.4

format: ## Format code
	@echo "✨ Formatting code..."
	go fmt ./...
	cd $(UI_DIR) && pnpm run format

# Pre-commit checks
pre-commit: format lint ## Run pre-commit checks
	@echo "✅ Pre-commit checks completed!"

test: ## Run tests
	@echo "🧪 Running tests..."
	go test -v ./...
	cd $(UI_DIR) && pnpm run test

e2e-install: ## Install e2e dependencies and Playwright browser
	@echo "📦 Installing e2e dependencies..."
	cd $(E2E_DIR) && pnpm install
	cd $(E2E_DIR) && pnpm exec playwright install chromium

e2e-kind-up: ## Create or reuse the local kind cluster for e2e
	@if kind get clusters | grep -qx "$(E2E_KIND_NAME)"; then \
		echo "☸️ Reusing kind cluster $(E2E_KIND_NAME)..."; \
		kind export kubeconfig --name "$(E2E_KIND_NAME)" --kubeconfig "$(E2E_KUBECONFIG)"; \
	else \
		echo "☸️ Creating kind cluster $(E2E_KIND_NAME)..."; \
		kind create cluster --name "$(E2E_KIND_NAME)" --wait 2m --kubeconfig "$(E2E_KUBECONFIG)"; \
	fi

e2e-kind-down: ## Delete the local kind cluster used by e2e
	@if kind get clusters | grep -qx "$(E2E_KIND_NAME)"; then \
		echo "🧹 Deleting kind cluster $(E2E_KIND_NAME)..."; \
		kind delete cluster --name "$(E2E_KIND_NAME)"; \
	else \
		echo "ℹ️ kind cluster $(E2E_KIND_NAME) does not exist"; \
	fi
	rm -f "$(E2E_KUBECONFIG)"

e2e-stop-app: ## Stop any local e2e app process listening on the e2e port
	@PIDS=$$(lsof -tiTCP:$(E2E_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	if [ -n "$$PIDS" ]; then \
		echo "🛑 Stopping local e2e app on port $(E2E_PORT)..."; \
		kill $$PIDS 2>/dev/null || true; \
		sleep 1; \
	fi

e2e-setup-ldap: ## Start the OpenLDAP service used by external-auth e2e
	@docker network inspect "$(E2E_AUTH_NETWORK)" >/dev/null 2>&1 || docker network create "$(E2E_AUTH_NETWORK)" >/dev/null
	@docker rm -f "$(E2E_LDAP_CONTAINER)" >/dev/null 2>&1 || true
	docker run -d --name "$(E2E_LDAP_CONTAINER)" \
		--network "$(E2E_AUTH_NETWORK)" \
		--network-alias ldap \
		-p "$(E2E_LDAP_PORT):389" \
		-e LDAP_ORGANISATION="Kite E2E" \
		-e LDAP_DOMAIN="kite.test" \
		-e LDAP_ADMIN_PASSWORD="admin" \
		-e LDAP_CONFIG_PASSWORD="admin" \
		-e LDAP_TLS="false" \
		-v "$(CURDIR)/e2e/fixtures/openldap:/container/service/slapd/assets/config/bootstrap/ldif/custom:ro" \
		osixia/openldap:1.5.0 --copy-service
	@for i in $$(seq 1 60); do \
		if docker exec "$(E2E_LDAP_CONTAINER)" ldapsearch -x -H ldap://localhost:389 -b dc=kite,dc=test -D "cn=admin,dc=kite,dc=test" -w admin >/dev/null 2>&1; then \
			break; \
		fi; \
		sleep 1; \
	done
	docker exec "$(E2E_LDAP_CONTAINER)" ldapsearch -x -H ldap://localhost:389 -b dc=kite,dc=test -D "cn=admin,dc=kite,dc=test" -w admin >/dev/null

e2e-setup-dex: ## Start the Dex service used by external-auth e2e
	@docker network inspect "$(E2E_AUTH_NETWORK)" >/dev/null 2>&1 || docker network create "$(E2E_AUTH_NETWORK)" >/dev/null
	@docker rm -f "$(E2E_DEX_CONTAINER)" >/dev/null 2>&1 || true
	docker run -d --name "$(E2E_DEX_CONTAINER)" \
		--network "$(E2E_AUTH_NETWORK)" \
		-p "$(E2E_OAUTH_PORT):5556" \
		-v "$(CURDIR)/e2e/fixtures/dex/config.yaml:/etc/dex/config.yaml:ro" \
		ghcr.io/dexidp/dex:v2.45.1 dex serve /etc/dex/config.yaml
	@for i in $$(seq 1 60); do \
		if curl -fsS "http://127.0.0.1:$(E2E_OAUTH_PORT)/.well-known/openid-configuration" >/dev/null; then \
			break; \
		fi; \
		sleep 1; \
	done
	curl -fsS "http://127.0.0.1:$(E2E_OAUTH_PORT)/.well-known/openid-configuration" >/dev/null

e2e-test: e2e-install e2e-kind-up e2e-stop-app ## Run e2e tests against the local kind cluster
	@echo "🧪 Running e2e tests..."
	cd $(E2E_DIR) && KUBECONFIG="$(E2E_KUBECONFIG)" KITE_E2E_CLUSTER_NAME="$(E2E_KIND_NAME)" KITE_E2E_PORT="$(E2E_PORT)" pnpm exec playwright test $(SPEC)

e2e-test-headed: e2e-install e2e-kind-up e2e-stop-app ## Run e2e tests in headed mode against the local kind cluster
	@echo "🧪 Running headed e2e tests..."
	cd $(E2E_DIR) && KUBECONFIG="$(E2E_KUBECONFIG)" KITE_E2E_CLUSTER_NAME="$(E2E_KIND_NAME)" KITE_E2E_PORT="$(E2E_PORT)" pnpm exec playwright test --headed $(SPEC)

docs-dev: ## Start documentation server in development mode
	@echo "📚 Starting documentation server..."
	cd docs && pnpm run docs:dev
docs-build: ## Build documentation
	@echo "📚 Building documentation..."
	cd docs && pnpm run docs:build
