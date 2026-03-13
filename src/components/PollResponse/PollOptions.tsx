import React from "react";
import { Box, Checkbox, Radio, Typography, Avatar } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { TextWithImages } from "../Common/Parsers/TextWithImages";
import { OptionResult } from "../../hooks/usePollResults";
import { useAppContext } from "../../hooks/useAppContext";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";

// Evenly-spaced hues for per-option bar colours
const BAR_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ef4444", // red
  "#14b8a6", // teal
  "#f97316", // orange
  "#ec4899", // pink
];

interface PollOptionsProps {
  options: [string, string, string][];
  pollType: "singlechoice" | "multiplechoice";
  selectedResponses: string[];
  onResponseChange: (optionId: string) => void;
  disabled: boolean;
  showResults: boolean;
  results: Map<string, OptionResult>;
  tags?: string[][];
}

const PollOptions: React.FC<PollOptionsProps> = ({
  options,
  pollType,
  selectedResponses,
  onResponseChange,
  disabled,
  showResults,
  results,
  tags,
}) => {
  const theme = useTheme();
  const { profiles } = useAppContext();

  const maxCount = Math.max(
    0,
    ...Array.from(results.values()).map((r) => r.count)
  );

  return (
    <Box>
      {options.map((option, optionIndex) => {
        const [, optionId, label] = option;
        const result = results.get(optionId);
        const percentage = result?.percentage ?? 0;
        const isLeading = showResults && !!result && result.count > 0 && result.count === maxCount;
        const isSelected = selectedResponses.includes(optionId);
        const barColor = BAR_COLORS[optionIndex % BAR_COLORS.length];
        const responders = result?.responders ?? [];

        return (
          <Box
            key={optionId}
            sx={{
              position: "relative",
              borderBottom: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
              "&:last-child": { borderBottom: "none" },
              overflow: "hidden",
              borderRadius: 1,
            }}
          >
            {/* Gradient progress bar */}
            <Box
              sx={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: showResults ? `${percentage}%` : "0%",
                background: isLeading
                  ? `linear-gradient(90deg, ${alpha(barColor, 0.50)} 0%, ${alpha(barColor, 0.10)} 100%)`
                  : `linear-gradient(90deg, ${alpha(barColor, 0.28)} 0%, ${alpha(barColor, 0.05)} 100%)`,
                borderRadius: "0 6px 6px 0",
                transition: "width 0.7s cubic-bezier(0.25, 1, 0.5, 1)",
                pointerEvents: "none",
              }}
            />

            {/* Option row */}
            <Box
              sx={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                py: 0.75,
                px: 0.5,
                cursor: disabled ? "default" : "pointer",
              }}
              onClick={() => !disabled && onResponseChange(optionId)}
            >
              {pollType === "singlechoice" ? (
                <Radio
                  checked={isSelected}
                  onChange={() => onResponseChange(optionId)}
                  disabled={disabled}
                  size="small"
                  sx={{ p: 0.5, flexShrink: 0 }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <Checkbox
                  checked={isSelected}
                  onChange={() => onResponseChange(optionId)}
                  disabled={disabled}
                  size="small"
                  sx={{ p: 0.5, flexShrink: 0 }}
                  onClick={(e) => e.stopPropagation()}
                />
              )}

              <Box sx={{ flex: 1, ml: 0.5, minWidth: 0 }}>
                <TextWithImages content={label} tags={tags} />
              </Box>

              {/* Right side: mini avatars + percentage */}
              {showResults && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: 1, flexShrink: 0 }}>
                  {responders.length > 0 && (
                    <Box sx={{ display: "flex", alignItems: "center", opacity: 0.55 }}>
                      {responders.slice(0, 4).map((pubkey, i) => (
                        <Avatar
                          key={pubkey}
                          src={profiles?.get(pubkey)?.picture || DEFAULT_IMAGE_URL}
                          sx={{
                            width: 16,
                            height: 16,
                            ml: i === 0 ? 0 : "-5px",
                            border: `1px solid ${theme.palette.background.paper}`,
                            zIndex: 4 - i,
                          }}
                        />
                      ))}
                      {responders.length > 4 && (
                        <Typography variant="caption" sx={{ ml: 0.5, fontSize: "0.65rem" }}>
                          +{responders.length - 4}
                        </Typography>
                      )}
                    </Box>
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      minWidth: 32,
                      textAlign: "right",
                      fontWeight: isLeading ? 700 : 400,
                      opacity: 0.9,
                    }}
                  >
                    {percentage.toFixed(0)}%
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default PollOptions;
