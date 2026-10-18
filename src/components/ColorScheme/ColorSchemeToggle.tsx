import React from "react";
import {Box, ButtonBase, useColorScheme} from "@mui/material";
import {LightModeRounded, BrightnessAutoRounded, DarkModeRounded} from "@mui/icons-material";

const MODES = [
    {value: "system", label: "System", Icon: BrightnessAutoRounded},
    {value: "light", label: "Light", Icon: LightModeRounded},
    {value: "dark", label: "Dark", Icon: DarkModeRounded},
] as const;

// Segmented control (Color Block): the active mode is an ink pill.
export const ColorSchemeToggle: React.FC<{ compact?: boolean }> = ({ compact }) => {
    const {mode, setMode} = useColorScheme()
    return (
        <Box role="radiogroup" aria-label="color scheme" sx={{display: "flex", gap: 0.5, p: 0.625, borderRadius: "18px", bgcolor: "cb.inner"}}>
            {MODES.map(({value, label, Icon}) => {
                const on = (mode ?? "system") === value;
                return (
                    <ButtonBase
                        key={value}
                        role="radio"
                        aria-checked={on}
                        aria-label={label}
                        title={label}
                        onClick={() => setMode(value)}
                        sx={{
                            flex: 1,
                            minWidth: compact ? 44 : undefined,
                            height: 40,
                            gap: 0.75,
                            borderRadius: "14px",
                            fontFamily: "inherit",
                            fontWeight: 700,
                            fontSize: 14,
                            bgcolor: on ? "text.primary" : "transparent",
                            color: on ? "background.default" : "text.secondary",
                            transition: "background-color .15s, color .15s",
                        }}
                    >
                        <Icon sx={{fontSize: 18}}/>
                        {!compact && label}
                    </ButtonBase>
                );
            })}
        </Box>
    );
}
