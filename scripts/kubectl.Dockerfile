# syntax=docker/dockerfile:1
# Minimal kubectl image with bash completion and common aliases

ARG KUBECTL_VERSION=v1.32.0

# ── builder: download kubectl ─────────────────────────────────────────────────
FROM debian:bookworm-slim AS builder

ARG KUBECTL_VERSION
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" \
    -o /usr/local/bin/kubectl \
  && chmod +x /usr/local/bin/kubectl

# ── final stage ───────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    bash-completion \
    curl \
    ca-certificates \
    less \
    jq \
    vim-tiny \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/kubectl /usr/local/bin/kubectl

# Shell configuration ----------------------------------------------------------
COPY <<'EOF' /etc/bash/bashrc.d/kubectl.bash
# kubectl tab completion
source /usr/share/bash-completion/bash_completion
source <(kubectl completion bash)

# Aliases
alias k='kubectl'
alias kg='kubectl get'
alias kd='kubectl describe'
alias kdel='kubectl delete'
alias kl='kubectl logs'
alias ke='kubectl exec -it'
alias kgp='kubectl get pods'
alias kgs='kubectl get svc'
alias kgn='kubectl get nodes'
alias kgetpods='kubectl get pods -A'

# kubectl completion for alias k
complete -o default -F __start_kubectl k
EOF

RUN echo '\n[ -d /etc/bash/bashrc.d ] && for f in /etc/bash/bashrc.d/*.bash; do source "$f"; done' \
    >> /etc/bash.bashrc

CMD ["/bin/bash"]
