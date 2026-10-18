import React from "react";
import { Box, Checkbox, Radio, Typography, Avatar } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { TextWithImages } from "../Common/Parsers/TextWithImages";
import { OptionResult } from "../../hooks/usePollResults";
import { useAppContext } from "../../hooks/useAppContext";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";

interface PollOptionsProps {
  options: [string, string, string][];
  pollType: "singlechoice" | "multiplechoice";
  selectedResponses: string[];
  onResponseChange: (optionId: string) => void;
  disabled: boolean;
  showResults: boolean;
  results: Map<string, OptionResult>;
  tags?: string[][];
  onVotersClick?: (optionId: string) => void;
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
  onVotersClick,
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
        const responders = result?.responders ?? [];

        return (
          <Box
            key={optionId}
            sx={{
              position: "relative",
              overflow: "hidden",
              // Color Block: each option is an inner slab; your pick gets a ring.
              borderRadius: "14px",
              bgcolor: "cb.inner",
              mb: 0.75,
              boxShadow: isSelected ? `inset 0 0 0 2px ${theme.palette.text.primary}` : "none",
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
                // Results fill in the poll color; the leading option is stronger.
                bgcolor: "cb.poll",
                opacity: isLeading ? 0.55 : 0.3,
                borderRadius: "14px",
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
                minHeight: 46,
                py: 0.5,
                px: 0.75,
                fontWeight: 600,
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
                  sx={{ p: 0.5, flexShrink: 0, "&.Mui-checked": { color: "text.primary" } }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <Checkbox
                  checked={isSelected}
                  onChange={() => onResponseChange(optionId)}
                  disabled={disabled}
                  size="small"
                  sx={{ p: 0.5, flexShrink: 0, "&.Mui-checked": { color: "text.primary" } }}
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
                    <Box
                      sx={{ display: "flex", alignItems: "center", opacity: 0.65, cursor: onVotersClick ? "pointer" : "default" }}
                      onClick={onVotersClick ? (e) => { e.stopPropagation(); onVotersClick(optionId); } : undefined}
                    >
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
                      fontWeight: 800,
                      fontSize: 13.5,
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
