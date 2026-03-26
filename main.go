package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "net/http/pprof"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/version"
	"k8s.io/klog/v2"
)

func main() {
	klog.InitFlags(nil)
	flag.Parse()
	go func() {
		log.Println(http.ListenAndServe("localhost:6060", nil))
	}()

	cm, err := initializeApp()
	if err != nil {
		log.Fatalf("Failed to initialize app: %v", err)
	}

	srv := &http.Server{
		Addr:    ":" + common.Port,
		Handler: buildEngine(cm).Handler(),
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
