package common

import (
	"os"
	"strings"
	"sync"
	"time"

	"k8s.io/klog/v2"
)

const (
	JWTExpirationSeconds = 24 * 60 * 60 // 24 hours
	DefaultJWTSecret     = "kite-default-jwt-secret-key-change-in-production"

	NodeTerminalPodName    = "kite-node-terminal-agent"
	KubectlTerminalPodName = "kite-kubectl-agent"

	KubectlAnnotation = "kubectl.kubernetes.io/last-applied-configuration"

	// db connection max idle time
	DBMaxIdleTime  = 10 * time.Minute
	DBMaxOpenConns = 100
	DBMaxIdleConns = 10
)

var (
	Port            = "8080"
	JwtSecret       = DefaultJWTSecret
	EnableAnalytics = false
	Host            = ""
	Base            = ""

	NodeTerminalImage    = "busybox:latest"
	KubectlTerminalImage = "zzde/kubectl:latest"
	DBType               = "sqlite"
	DBDSN                = "dev.db"

	KiteEncryptKey = "kite-default-encryption-key-change-in-production"

	AllNamespaces = "_all"

	AnonymousUserEnabled = false

	CookieExpirationSeconds = 2 * JWTExpirationSeconds // double jwt

	DisableGZIP        = true
	EnableVersionCheck = true

	// CORSAllowedOrigins is empty by default (no CORS in production).
	// Developers can set CORS_ALLOWED_ORIGINS=http://localhost:5173 for
	// local Vite dev server cross-origin requests.
	CORSAllowedOrigins []string

	APIKeyProvider = "api_key"

	AgentPodNamespace = "kube-system"

	// ConfigFilePath is the path to the external config file (set via KITE_CONFIG_FILE env)
	ConfigFilePath = ""

	// ManagedSections tracks which configuration sections are managed by the config file.
	// Keys: "clusters", "oauth", "ldap", "rbac", "superUser"
	ManagedSections = map[string]bool{}
	managedMu       sync.RWMutex
)

const ManagedSectionError = "This section is managed by configuration file and cannot be modified through the UI"

func IsSectionManaged(section string) bool {
	managedMu.RLock()
	defer managedMu.RUnlock()
	return ManagedSections[section]
}

func SetManagedSections(sections map[string]bool) {
	managedMu.Lock()
	defer managedMu.Unlock()

	ManagedSections = make(map[string]bool, len(sections))
	for section, managed := range sections {
		if managed {
			ManagedSections[section] = true
		}
	}
}

func LoadEnvs() {
	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		JwtSecret = secret
	}

	if port := os.Getenv("PORT"); port != "" {
		Port = port
	}

	if analytics := os.Getenv("ENABLE_ANALYTICS"); analytics == "true" {
		EnableAnalytics = true
	}
	if ns := os.Getenv("NAMESPACE"); ns != "" {
		AgentPodNamespace = ns
	}

	if nodeTerminalImage := os.Getenv("NODE_TERMINAL_IMAGE"); nodeTerminalImage != "" {
		NodeTerminalImage = nodeTerminalImage
	}

	if kubectlTerminalImage := os.Getenv("KUBECTL_TERMINAL_IMAGE"); kubectlTerminalImage != "" {
		KubectlTerminalImage = kubectlTerminalImage
	}

	if dbDSN := os.Getenv("DB_DSN"); dbDSN != "" {
		DBDSN = dbDSN
	}

	if dbType := os.Getenv("DB_TYPE"); dbType != "" {
		if dbType != "sqlite" && dbType != "mysql" && dbType != "postgres" {
			klog.Fatalf("Invalid DB_TYPE: %s, must be one of sqlite, mysql, postgres", dbType)
		}
		DBType = dbType
	}

	if key := os.Getenv("KITE_ENCRYPT_KEY"); key != "" {
		KiteEncryptKey = key
	} else {
		klog.Warningf("KITE_ENCRYPT_KEY is not set, using default key, this is not secure for production!")
	}

	if v := os.Getenv("ANONYMOUS_USER_ENABLED"); v == "true" {
		AnonymousUserEnabled = true
		klog.Warningf("Anonymous user is enabled, this is not secure for production!")
	}
	if v := os.Getenv("HOST"); v != "" {
		Host = v
	}
	if v := os.Getenv("DISABLE_GZIP"); v != "" {
		DisableGZIP = v == "true"
	}

	if v := os.Getenv("DISABLE_VERSION_CHECK"); v == "true" {
		EnableVersionCheck = false
	}

	if v := os.Getenv("KITE_BASE"); v != "" {
		if v[0] != '/' {
			v = "/" + v
		}
		Base = strings.TrimRight(v, "/")
		klog.Infof("Using base path: %s", Base)
	}

	if v := os.Getenv("KITE_CONFIG_FILE"); v != "" {
		ConfigFilePath = v
	}

	if v := os.Getenv("CORS_ALLOWED_ORIGINS"); v != "" {
		origins := strings.Split(v, ",")
		for _, o := range origins {
			o = strings.TrimSpace(o)
			if o != "" {
				CORSAllowedOrigins = append(CORSAllowedOrigins, o)
			}
		}
		klog.Warningf("CORS enabled for origins: %v — disable in production", CORSAllowedOrigins)
	}
}
