package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/zxh326/kite/pkg/ai"
	"github.com/zxh326/kite/pkg/auth"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/handlers"
	"github.com/zxh326/kite/pkg/handlers/resources"
	"github.com/zxh326/kite/pkg/middleware"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/version"
	ctrlmetrics "sigs.k8s.io/controller-runtime/pkg/metrics"
)

func setupAPIRouter(r *gin.RouterGroup, cm *cluster.ClusterManager) {
	authHandler := auth.NewAuthHandler()

	registerBaseRoutes(r)
	registerAuthRoutes(r, authHandler)
	registerUserRoutes(r, authHandler)
	registerAdminRoutes(r, authHandler, cm)
	registerProtectedRoutes(r, authHandler, cm)
}

func registerBaseRoutes(r *gin.RouterGroup) {
	r.GET("/metrics", gin.WrapH(promhttp.HandlerFor(prometheus.Gatherers{
		prometheus.DefaultGatherer,
		ctrlmetrics.Registry,
	}, promhttp.HandlerOpts{})))
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	r.GET("/api/v1/init_check", handlers.InitCheck)
	r.GET("/api/v1/version", version.GetVersion)
}

func registerAuthRoutes(r *gin.RouterGroup, authHandler *auth.AuthHandler) {
	authGroup := r.Group("/api/auth")
	authGroup.GET("/providers", authHandler.GetProviders)
	authGroup.POST("/login/password", authHandler.PasswordLogin)
	authGroup.POST("/login/ldap", authHandler.LDAPLogin)
	authGroup.GET("/login", authHandler.Login)
	authGroup.GET("/callback", authHandler.Callback)
	authGroup.POST("/logout", authHandler.Logout)
	authGroup.POST("/refresh", authHandler.RefreshToken)
	authGroup.GET("/user", authHandler.RequireAuth(), authHandler.GetUser)
}

func registerUserRoutes(r *gin.RouterGroup, authHandler *auth.AuthHandler) {
	userGroup := r.Group("/api/users")
	userGroup.POST("/sidebar_preference", authHandler.RequireAuth(), handlers.UpdateSidebarPreference)
}

func registerAdminRoutes(r *gin.RouterGroup, authHandler *auth.AuthHandler, cm *cluster.ClusterManager) {
	adminAPI := r.Group("/api/v1/admin")
	adminAPI.POST("/users/create_super_user", handlers.CreateSuperUser)
	adminAPI.POST("/clusters/import", cm.ImportClustersFromKubeconfig)
	adminAPI.Use(authHandler.RequireAuth(), authHandler.RequireAdmin())

	adminAPI.GET("/audit-logs", handlers.ListAuditLogs)

	oauthProviderAPI := adminAPI.Group("/oauth-providers")
	oauthProviderAPI.GET("/", authHandler.ListOAuthProviders)
	oauthProviderAPI.POST("/", authHandler.CreateOAuthProvider)
	oauthProviderAPI.GET("/:id", authHandler.GetOAuthProvider)
	oauthProviderAPI.PUT("/:id", authHandler.UpdateOAuthProvider)
	oauthProviderAPI.DELETE("/:id", authHandler.DeleteOAuthProvider)

	ldapSettingAPI := adminAPI.Group("/ldap-setting")
	ldapSettingAPI.GET("/", authHandler.GetLDAPSetting)
	ldapSettingAPI.PUT("/", authHandler.UpdateLDAPSetting)

	clusterAPI := adminAPI.Group("/clusters")
	clusterAPI.GET("/", cm.GetClusterList)
	clusterAPI.POST("/", cm.CreateCluster)
	clusterAPI.PUT("/:id", cm.UpdateCluster)
	clusterAPI.DELETE("/:id", cm.DeleteCluster)

	rbacAPI := adminAPI.Group("/roles")
	rbacAPI.GET("/", rbac.ListRoles)
	rbacAPI.POST("/", rbac.CreateRole)
	rbacAPI.GET("/:id", rbac.GetRole)
	rbacAPI.PUT("/:id", rbac.UpdateRole)
	rbacAPI.DELETE("/:id", rbac.DeleteRole)
	rbacAPI.POST("/:id/assign", rbac.AssignRole)
	rbacAPI.DELETE("/:id/assign", rbac.UnassignRole)

	userAPI := adminAPI.Group("/users")
	userAPI.GET("/", handlers.ListUsers)
	userAPI.POST("/", handlers.CreatePasswordUser)
	userAPI.PUT("/:id", handlers.UpdateUser)
	userAPI.DELETE("/:id", handlers.DeleteUser)
	userAPI.POST("/:id/reset_password", handlers.ResetPassword)
	userAPI.POST("/:id/enable", handlers.SetUserEnabled)
	adminAPI.POST("/sidebar_preference/global", handlers.UpdateGlobalSidebarPreference)
	adminAPI.DELETE("/sidebar_preference/global", handlers.ClearGlobalSidebarPreference)

	apiKeyAPI := adminAPI.Group("/apikeys")
	apiKeyAPI.GET("/", handlers.ListAPIKeys)
	apiKeyAPI.POST("/", handlers.CreateAPIKey)
	apiKeyAPI.DELETE("/:id", handlers.DeleteAPIKey)

	generalSettingAPI := adminAPI.Group("/general-setting")
	generalSettingAPI.GET("/", ai.HandleGetGeneralSetting)
	generalSettingAPI.PUT("/", ai.HandleUpdateGeneralSetting)

	templateAPI := adminAPI.Group("/templates")
	templateAPI.POST("/", handlers.CreateTemplate)
	templateAPI.PUT("/:id", handlers.UpdateTemplate)
	templateAPI.DELETE("/:id", handlers.DeleteTemplate)
}

func registerProtectedRoutes(r *gin.RouterGroup, authHandler *auth.AuthHandler, cm *cluster.ClusterManager) {
	api := r.Group("/api/v1")
	api.GET("/clusters", authHandler.RequireAuth(), cm.GetClusters)
	api.Use(authHandler.RequireAuth(), middleware.ClusterMiddleware(cm))

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

	api.GET("/ai/status", ai.HandleAIStatus)
	api.POST("/ai/chat", ai.HandleChat)
	api.POST("/ai/execute/continue", ai.HandleExecuteContinue)
	api.POST("/ai/input/continue", ai.HandleInputContinue)

	api.Use(middleware.RBACMiddleware())
	resources.RegisterRoutes(api)
}
