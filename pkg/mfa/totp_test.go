package mfa

import (
	"encoding/base32"
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestGenerateSecret(t *testing.T) {
	secret, err := GenerateSecret()
	if err != nil {
		t.Fatalf("GenerateSecret() error = %v", err)
	}

	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		t.Fatalf("generated secret is not valid base32: %v", err)
	}
	if len(decoded) != secretSize {
		t.Fatalf("decoded secret length = %d, want %d", len(decoded), secretSize)
	}
}

func TestURL(t *testing.T) {
	value := URL("alice@example.com", "SECRET")
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatalf("url.Parse() error = %v", err)
	}

	if parsed.Scheme != "otpauth" || parsed.Host != "totp" {
		t.Fatalf("URL() = %q, want otpauth TOTP URL", value)
	}
	if parsed.Path != "/Kite:alice@example.com" {
		t.Fatalf("URL path = %q, want %q", parsed.Path, "/Kite:alice@example.com")
	}
	if got := parsed.Query().Get("secret"); got != "SECRET" {
		t.Fatalf("secret query = %q, want %q", got, "SECRET")
	}
	if got := parsed.Query().Get("issuer"); got != issuer {
		t.Fatalf("issuer query = %q, want %q", got, issuer)
	}
}

func TestGenerateCodeRFC6238Vectors(t *testing.T) {
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	tests := []struct {
		unixTime int64
		want     string
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1111111111, "050471"},
		{1234567890, "005924"},
		{2000000000, "279037"},
		{20000000000, "353130"},
	}

	for _, tt := range tests {
		if got := generateCode(secret, uint64(tt.unixTime/step)); got != tt.want {
			t.Errorf("generateCode() at %d = %q, want %q", tt.unixTime, got, tt.want)
		}
	}
}

func TestVerifyAcceptsCurrentCodeAndFormatting(t *testing.T) {
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	counter := time.Now().Unix() / step
	code := generateCode(secret, uint64(counter))

	if !Verify(secret, " "+code[:3]+" "+code[3:]+" ") {
		t.Fatal("Verify() rejected the current code with harmless whitespace")
	}
	if !Verify(secret, generateCode(secret, uint64(counter-1))) {
		t.Fatal("Verify() rejected a code from the allowed previous time step")
	}

	for _, invalid := range []string{"12345", "1234567", "12ab56"} {
		if Verify(secret, invalid) {
			t.Fatalf("Verify() accepted invalid code %q", invalid)
		}
	}
	if Verify("not-base32!", "123456") {
		t.Fatal("Verify() accepted a code with an invalid secret")
	}
}

func TestQRCodeDataURL(t *testing.T) {
	value, err := QRCodeDataURL("otpauth://totp/Kite:test?secret=SECRET")
	if err != nil {
		t.Fatalf("QRCodeDataURL() error = %v", err)
	}

	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(value, prefix) {
		t.Fatalf("QRCodeDataURL() missing PNG data URL prefix")
	}
	png, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil {
		t.Fatalf("QRCodeDataURL() payload is not base64: %v", err)
	}
	if len(png) < 8 || string(png[:8]) != "\x89PNG\r\n\x1a\n" {
		t.Fatal("QRCodeDataURL() payload is not a PNG")
	}
}
