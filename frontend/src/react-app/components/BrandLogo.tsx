import React from "react";
import { useBranding, DEFAULT_BRANDING } from "@pazl/services/BrandingService";

/**
 * The app logo from Settings → Branding, or `fallback` (the built-in PAZL
 * logo that place always used) when none is uploaded. Same props as <img>.
 */
export const BrandLogo = ({
  fallback,
  style,
  ...img
}: React.ImgHTMLAttributes<HTMLImageElement> & { fallback: string }) => {
  const brand = useBranding();
  return <img {...img} src={brand.logo || fallback} style={{ objectFit: "contain", ...style }} />;
};

/**
 * The app name from Settings → Branding. `fallback` is what that place said
 * before (e.g. "Pazl"), kept while the name is still the default "PAZL".
 */
export const BrandName = ({ fallback }: { fallback?: string }) => {
  const name = useBranding().appName;
  return <>{fallback && name === DEFAULT_BRANDING.appName ? fallback : name}</>;
};

export default BrandLogo;
