package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "net/http/pprof"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/zxh326/kite/internal"
	"github.com/zxh326/kite/pkg/auth"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/handlers"
	"github.com/zxh326/kite/pkg/handlers/resources"
	"github.com/zxh326/kite/pkg/middleware"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/utils"
	"github.com/zxh326/kite/pkg/version"
	"k8s.io/klog/v2"
	ctrlmetrics "sigs.k8s.io/controller-runtime/pkg/metrics"
)

//go:embed static
var static embed.FS

func setupStatic(r *gin.Engine) {
	base := common.Base
	if base != "" && base != "/" {
		r.GET("/", func(c *gin.Context) {
			c.Redirect(http.StatusFound, base+"/")
		})
	}
	assertsFS, err := fs.Sub(static, "static/assets")
	if err != nil {
		panic(err)
	}
	// Apply cache control middleware for static assets
	assetsGroup := r.Group(base + "/assets")
	assetsGroup.Use(middleware.StaticCache())
	assetsGroup.StaticFS("/", http.FS(assertsFS))
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if len(path) >= len(base)+5 && path[len(base):len(base)+5] == "/api/" {
			c.JSON(http.StatusNotFound, gin.H{"error": "API endpoint not found"})
			return
		}

		content, err := static.ReadFile("static/index.html")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read index.html"})
			return
		}

		htmlContent := string(content)
		htmlContent = utils.InjectKiteBase(htmlContent, base)
		if common.EnableAnalytics {
			htmlContent = utils.InjectAnalytics(htmlContent)
		}

		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusOK, htmlContent)
	})
}

func setupAPIRouter(r *gin.RouterGroup, cm *cluster.ClusterManager) {
	r.GET("/metrics", gin.WrapH(promhttp.HandlerFor(prometheus.Gatherers{
		prometheus.DefaultGatherer,
		ctrlmetrics.Registry,
	}, promhttp.HandlerOpts{})))
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
		})
	})
	r.GET("/api/v1/init_check", handlers.InitCheck)
	r.GET("/api/v1/version", version.GetVersion)
	// Auth routes (no auth required)
	authHandler := auth.NewAuthHandler()
	authGroup := r.Group("/api/auth")
	{
		authGroup.GET("/providers", authHandler.GetProviders)
		authGroup.POST("/login/password", authHandler.PasswordLogin)
		authGroup.GET("/login", authHandler.Login)
		authGroup.GET("/callback", authHandler.Callback)
		authGroup.POST("/logout", authHandler.Logout)
		authGroup.POST("/refresh", authHandler.RefreshToken)
		authGroup.GET("/user", authHandler.RequireAuth(), authHandler.GetUser)
	}

	userGroup := r.Group("/api/users")
	{
		userGroup.POST("/sidebar_preference", authHandler.RequireAuth(), handlers.UpdateSidebarPreference)
	}

	// admin apis
	adminAPI := r.Group("/api/v1/admin")
	// Initialize the setup API without authentication.
	// Once users are configured, this API cannot be used.
	adminAPI.POST("/users/create_super_user", handlers.CreateSuperUser)
	adminAPI.POST("/clusters/import", cm.ImportClustersFromKubeconfig)
	adminAPI.Use(authHandler.RequireAuth(), authHandler.RequireAdmin())
	{
		adminAPI.GET("/audit-logs", handlers.ListAuditLogs)
		oauthProviderAPI := adminAPI.Group("/oauth-providers")
		{
			oauthProviderAPI.GET("/", authHandler.ListOAuthProviders)
			oauthProviderAPI.POST("/", authHandler.CreateOAuthProvider)
			oauthProviderAPI.GET("/:id", authHandler.GetOAuthProvider)
			oauthProviderAPI.PUT("/:id", authHandler.UpdateOAuthProvider)
			oauthProviderAPI.DELETE("/:id", authHandler.DeleteOAuthProvider)
		}

		clusterAPI := adminAPI.Group("/clusters")
		{
			clusterAPI.GET("/", cm.GetClusterList)
			clusterAPI.POST("/", cm.CreateCluster)
			clusterAPI.PUT("/:id", cm.UpdateCluster)
			clusterAPI.DELETE("/:id", cm.DeleteCluster)
		}

		rbacAPI := adminAPI.Group("/roles")
		{
			rbacAPI.GET("/", rbac.ListRoles)
			rbacAPI.POST("/", rbac.CreateRole)
			rbacAPI.GET("/:id", rbac.GetRole)
			rbacAPI.PUT("/:id", rbac.UpdateRole)
			rbacAPI.DELETE("/:id", rbac.DeleteRole)

			rbacAPI.POST("/:id/assign", rbac.AssignRole)
			rbacAPI.DELETE("/:id/assign", rbac.UnassignRole)
		}

		userAPI := adminAPI.Group("/users")
		{
			userAPI.GET("/", handlers.ListUsers)
			userAPI.POST("/", handlers.CreatePasswordUser)
			userAPI.PUT(":id", handlers.UpdateUser)
			userAPI.DELETE(":id", handlers.DeleteUser)
			userAPI.POST(":id/reset_password", handlers.ResetPassword)
			userAPI.POST(":id/enable", handlers.SetUserEnabled)
		}

		apiKeyAPI := adminAPI.Group("/apikeys")
		{
			apiKeyAPI.GET("/", handlers.ListAPIKeys)
			apiKeyAPI.POST("/", handlers.CreateAPIKey)
			apiKeyAPI.DELETE("/:id", handlers.DeleteAPIKey)
		}

		templateAPI := adminAPI.Group("/templates")
		{
			templateAPI.POST("/", handlers.CreateTemplate)
			templateAPI.PUT("/:id", handlers.UpdateTemplate)
			templateAPI.DELETE("/:id", handlers.DeleteTemplate)
		}
	}

	// API routes group (protected)
	api := r.Group("/api/v1")
	api.GET("/clusters", authHandler.RequireAuth(), cm.GetClusters)
	api.Use(authHandler.RequireAuth(), middleware.ClusterMiddleware(cm))
	{
		api.GET("/overview", handlers.GetOverview)

		promHandler := handlers.NewPromHandler()
		api.GET("/prometheus/resource-usage-history", promHandler.GetResourceUsageHistory)
		api.GET("/prometheus/pods/:namespace/:podName/metrics", promHandler.GetPodMetrics)

		logsHandler := handlers.NewLogsHandler()
		api.GET("/logs/:namespace/:podName/ws", logsHandler.HandleLogsWebSocket)

		terminalHandler := handlers.NewTerminalHandler()
		api.GET("/terminal/:namespace/:podName/ws", terminalHandler.HandleTerminalWebSocket)

		nodeTerminalHandler := handlers.NewNodeTerminalHandler()
		api.GET("/node-terminal/:nodeName/ws", nodeTerminalHandler.HandleNodeTerminalWebSocket)

		kubectlTerminalHandler := handlers.NewKubectlTerminalHandler()
		api.GET("/kubectl-terminal/ws", kubectlTerminalHandler.HandleKubectlTerminalWebSocket)

		searchHandler := handlers.NewSearchHandler()
		api.GET("/search", searchHandler.GlobalSearch)

		resourceApplyHandler := handlers.NewResourceApplyHandler()
		api.POST("/resources/apply", resourceApplyHandler.ApplyResource)

		api.GET("/image/tags", handlers.GetImageTags)
		api.GET("/templates", handlers.ListTemplates)

		proxyHandler := handlers.NewProxyHandler()
		proxyHandler.RegisterRoutes(api)

		api.Use(middleware.RBACMiddleware())
		resources.RegisterRoutes(api)
	}
}

func main() {
	klog.InitFlags(nil)
	flag.Parse()
	go func() {
		log.Println(http.ListenAndServe("localhost:6060", nil))
	}()
	common.LoadEnvs()
	if klog.V(1).Enabled() {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(middleware.Metrics())
	if !common.DisableGZIP {
		klog.Info("GZIP compression is enabled")
		r.Use(gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPaths([]string{"/metrics"})))
	}
	r.Use(gin.Recovery())
	r.Use(middleware.Logger())
	r.Use(middleware.CORS())
	model.InitDB()
	rbac.InitRBAC()
	handlers.InitTemplates()
	internal.LoadConfigFromEnv()

	cm, err := cluster.NewClusterManager()
	if err != nil {
		log.Fatalf("Failed to create ClusterManager: %v", err)
	}

	base := r.Group(common.Base)
	// Setup router
	setupAPIRouter(base, cm)
	setupStatic(r)

	srv := &http.Server{
		Addr:    ":" + common.Port,
		Handler: r.Handler(),
	}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			klog.Fatalf("Failed to start server: %v", err)
		}
	}()
	klog.Infof("Kite server started on port %s", common.Port)
	klog.Infof("Version: %s, Build Date: %s, Commit: %s",
		version.Version, version.BuildDate, version.CommitID)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	klog.Info("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		klog.Fatalf("Failed to shutdown server: %v", err)
	}
}
