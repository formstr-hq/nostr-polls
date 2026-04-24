import {createTheme} from "@mui/material/styles";
import {Theme} from "@mui/system/createTheme";
import {CSSObject} from "@mui/material";

export const getColorsWithTheme = (theme: Theme, styles: CSSObject, contrast: CSSObject = {}) => {
  const contrastStyles = Object.keys(styles).reduce<CSSObject>((map, key) => {
    map[key] = contrast[key] || theme.palette.getContrastText(styles[key])
    return map
  }, {})
  return {
    ...theme.applyStyles('light', styles),
    ...theme.applyStyles('dark', contrastStyles)
  }
}

export function buildTheme(
  fontFamily: string,
  lightPrimary: string,
  darkPrimary: string,
  lightBg: string,
  darkBg: string,
) {
  return createTheme({
    typography: {
      fontFamily,
    },
    colorSchemes: {
      dark: {
        palette: {
          mode: "dark",
          primary: { main: darkPrimary },
          secondary: { main: "#bdbdbc" },
          background: { default: darkBg, paper: darkBg },
        },
      },
      light: {
        palette: {
          primary: { main: lightPrimary },
          secondary: { main: "#bdbdbc" },
          background: { default: lightBg, paper: lightBg },
        },
      }
    },
    palette: {
      mode: "light",
      primary: { main: lightPrimary },
      secondary: { main: "#bdbdbc" },
      background: { default: lightBg, paper: lightBg },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: (theme) => ({
          body: {
            backgroundColor: theme.palette.mode === 'dark' ? darkBg : lightBg,
          }
        })
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: "50px",
            textTransform: "none",
          },
          text: ({ theme }) => ({
            color: theme.palette.mode === 'dark' ? theme.palette.primary.main : '#000000',
            '&:hover': {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(0,0,0,0.04)',
            },
          }),
          outlined: ({ theme }) => ({
            color: theme.palette.mode === 'dark' ? theme.palette.primary.main : '#000000',
            borderColor: theme.palette.mode === 'dark' ? theme.palette.primary.main : '#000000',
            '&:hover': {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(0,0,0,0.04)',
              borderColor: theme.palette.mode === 'dark' ? theme.palette.primary.main : '#000000',
            },
          }),
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: ({ theme }) => ({
            // StyledAppBar sets bg to white (light) or black (dark).
            // Override the inherited primary.contrastText so icons are
            // always visible regardless of which primary color is active.
            color: theme.palette.mode === 'dark' ? '#ffffff' : 'rgba(0,0,0,0.87)',
          }),
        },
      },
      MuiModal: {
        styleOverrides: {
          root: {
            overflowY: "auto",
          },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            overflow: "hidden",
            "& > *:not(img)": {
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          fallback: {
            width: "75%",
            height: "75%",
          },
        },
      },
    },
  });
}

// Default theme instance — used as a static fallback
export const baseTheme = buildTheme(
  '"Shantell Sans", sans-serif',
  '#DAA520',
  '#FAD13F',
  '#f5f4f1',
  '#3d3d3d',
);
