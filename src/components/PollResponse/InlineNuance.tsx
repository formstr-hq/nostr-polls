import React, { useState } from "react";
import {
  Box,
  TextField,
  Typography,
  Collapse,
  CircularProgress,
} from "@mui/material";
import { alpha, useTheme, keyframes } from "@mui/material/styles";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { NuanceOption } from "../../hooks/useNuanceOptions";

export type NuanceResult =
  | { type: "cosign"; eventId: string }
  | { type: "freeform"; text: string }
  | { type: "skip" };

interface InlineNuanceProps {
  optionLabel: string;
  nuanceText: string;
  onNuanceTextChange: (text: string) => void;
  cosignedOption: NuanceOption | null;
  onCosign: (option: NuanceOption | null) => void;
  nuanceOptions: NuanceOption[];
  nuanceLoading: boolean;
  disabled: boolean;
  submitted: boolean;
  confirmationNuance: NuanceResult | null;
}

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const InlineNuance: React.FC<InlineNuanceProps> = ({
  optionLabel,
  nuanceText,
  onNuanceTextChange,
  cosignedOption,
  onCosign,
  nuanceOptions,
  nuanceLoading,
  disabled,
  submitted,
  confirmationNuance,
}) => {
  const theme = useTheme();
  const [existingExpanded, setExistingExpanded] = useState(false);

  const handleCosignClick = (opt: NuanceOption) => {
    if (disabled) return;
    if (cosignedOption?.sourceEventId === opt.sourceEventId) {
      // Deselect
      onCosign(null);
      onNuanceTextChange("");
    } else {
      onCosign(opt);
      onNuanceTextChange(opt.text);
    }
  };

  const handleTextChange = (text: string) => {
    onNuanceTextChange(text);
    // If user edits after co-sign, clear the co-sign
    if (cosignedOption && text !== cosignedOption.text) {
      onCosign(null);
    }
  };

  const showToggle = nuanceLoading || nuanceOptions.length > 0;

  // Build confirmation text
  const getConfirmationText = () => {
    if (!confirmationNuance) return "";
    if (confirmationNuance.type === "cosign") {
      const text = cosignedOption?.text || nuanceText;
      return `kind:1018 emitted \u2014 co-signed: \u201c${text}\u201d`;
    }
    if (confirmationNuance.type === "freeform") {
      return `kind:1018 emitted \u2014 \u201c${confirmationNuance.text}\u201d`;
    }
    return "kind:1018 emitted";
  };

  return (
    <Box
      sx={{
        borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
        pt: 1.5,
        px: 1.5,
        pb: 1,
        mt: 1,
      }}
    >
      {/* Text input */}
      <TextField
        fullWidth
        size="small"
        placeholder={`what do you mean by \u201c${optionLabel}\u201d?`}
        value={nuanceText}
        onChange={(e) => handleTextChange(e.target.value)}
        inputProps={{ maxLength: 80 }}
        disabled={disabled}
        autoFocus
        sx={{
          mb: 1,
          "& .MuiOutlinedInput-root": cosignedOption
            ? {
                borderColor: "#22c55e",
                "& fieldset": { borderColor: "#22c55e" },
              }
            : {},
        }}
      />

      {/* "X others elaborated" toggle */}
      {showToggle && (
        <Box
          onClick={() => !nuanceLoading && setExistingExpanded((v) => !v)}
          sx={{
            cursor: nuanceLoading ? "default" : "pointer",
            textAlign: "center",
            mb: 0.5,
            userSelect: "none",
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}
          >
            {nuanceLoading ? (
              <>
                <CircularProgress size={12} sx={{ mr: 0.5 }} />
                loading...
              </>
            ) : (
              <>
                <ChevronRightIcon
                  sx={{
                    fontSize: 16,
                    transform: existingExpanded ? "rotate(90deg)" : "none",
                    transition: "transform 0.2s ease",
                  }}
                />
                {nuanceOptions.length}{" "}
                {nuanceOptions.length === 1 ? "other" : "others"} elaborated
              </>
            )}
          </Typography>
        </Box>
      )}

      {/* Existing nuance list */}
      <Collapse in={existingExpanded && !nuanceLoading} timeout={200} unmountOnExit>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1 }}>
          {nuanceOptions.map((opt) => {
            const isSelected =
              cosignedOption?.sourceEventId === opt.sourceEventId;
            return (
              <Box
                key={opt.sourceEventId}
                onClick={() => handleCosignClick(opt)}
                sx={{
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 1,
                  cursor: disabled ? "default" : "pointer",
                  border: isSelected
                    ? "1px solid #22c55e"
                    : `1px solid transparent`,
                  bgcolor: isSelected
                    ? alpha("#22c55e", 0.08)
                    : "transparent",
                  "&:hover": disabled
                    ? {}
                    : { bgcolor: alpha(theme.palette.action.hover, 0.04) },
                  transition: "all 0.15s ease",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                    {opt.text}
                  </Typography>
                  {opt.count > 1 && (
                    <Box
                      sx={{
                        px: 1,
                        py: 0.25,
                        borderRadius: 10,
                        bgcolor: alpha(theme.palette.text.secondary, 0.1),
                        ml: 1,
                        flexShrink: 0,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {opt.count}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Collapse>

      {/* Confirmation bar */}
      <Collapse in={submitted} timeout={250}>
        <Box
          sx={{
            mt: 0.5,
            px: 1.5,
            py: 1,
            borderRadius: 1,
            bgcolor: alpha("#22c55e", 0.1),
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              bgcolor: "#22c55e",
              animation: `${pulse} 2s ease-in-out infinite`,
              flexShrink: 0,
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {getConfirmationText()}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
};

export default InlineNuance;
