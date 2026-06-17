import React from "react";
import { useTheme } from "@mui/material/styles";

interface PolleramaLogoProps {
  height?: number;
}

const PolleramaLogo: React.FC<PolleramaLogoProps> = ({ height = 36 }) => {
  const theme = useTheme();
  // Wordmark flips with light/dark and uses the active font preset; the bottom
  // shape follows the active color preset's primary. The outline stays black.
  const textColor = theme.palette.mode === "dark" ? "#ffffff" : "#000000";
  const accent = theme.palette.primary.main;

  // Icon occupies viewBox x 0-140; the wordmark fills the rest.
  return (
    <svg
      viewBox="0 0 452 100"
      height={height}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Pollerama"
    >
      {/* Logo icon — top shape (white) */}
      <path
        d="M22.4236 7.33331H88.083C93.4046 7.33331 98.709 9.95954 100.13 15.0878C101.709 20.782 101.126 26.0778 99.8354 30.2072C98.4366 34.6824 93.9122 36.9928 89.2286 37.2111C62.6644 38.449 19.1398 39.7074 11.7941 36.8452C6.27402 34.6943 6.72579 25.6851 8.63951 17.4744C10.0956 11.2272 16.0091 7.33331 22.4236 7.33331Z"
        fill="white"
        stroke="black"
        strokeWidth="13.75"
      />
      {/* Logo icon — bottom shape (accent, themed) */}
      <path
        d="M22.7133 59.4166H119.19C123.757 59.4166 128.382 61.283 130.326 65.4154C133.674 72.5329 132.333 79.1629 129.943 83.8624C128.134 87.4204 124.173 89.0182 120.184 89.1638C85.2582 90.4385 23.4205 91.8916 13.281 88.9285C5.47425 86.6471 6.62573 76.6497 9.55968 68.0733C11.4373 62.5849 16.9126 59.4166 22.7133 59.4166Z"
        fill={accent}
        stroke="black"
        strokeWidth="13.75"
      />
      {/* "Pollerama" wordmark — follows the active font preset and theme color */}
      <text
        x="150"
        y="52"
        fill={textColor}
        fontFamily={theme.typography.fontFamily}
        fontSize="58"
        fontWeight={600}
        dominantBaseline="central"
        textLength="296"
        lengthAdjust="spacingAndGlyphs"
      >
        Pollerama
      </text>
    </svg>
  );
};

export default PolleramaLogo;
