import React, { useState, useEffect } from "react";
import { AppBar, Toolbar, Typography, Button, IconButton, Badge } from "@mui/material";
import { styled } from "@mui/system";
import MailIcon from "@mui/icons-material/Mail";
import SearchIcon from "@mui/icons-material/Search";
import logo from "../../Images/logo.svg";
import { UserMenu } from "./UserMenu";
import { useNavigate } from "react-router-dom";
import { getColorsWithTheme } from "../../styles/theme";
import { NotificationBell } from "./NotificationBell";
import { useDMContext } from "../../hooks/useDMContext";
import { SearchModal } from "../Search/SearchModal";

const StyledAppBar = styled(AppBar)(({ theme }) => {
  return {
    backgroundColor: theme.palette.mode === "dark" ? "#000000" : "#ffffff",
  };
});

const StyledButton = styled(Button)(({ theme }) => ({
  ...getColorsWithTheme(theme, {
    color: "#000000",
  }),
}));

const HeaderCenterSection = styled("div")({
  flexGrow: 1,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
});

const HeaderRightSection = styled("div")({
  marginLeft: "auto",
  display: "flex",
});

const LogoAndTitle = styled("div")({
  display: "flex",
  alignItems: "center",
});

const Header: React.FC = () => {
  let navigate = useNavigate();
  const { unreadTotal } = useDMContext();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <>
      <StyledAppBar position="static">
        <Toolbar>
          <HeaderCenterSection>
            <LogoAndTitle>
              <StyledButton onClick={() => navigate("/")} variant="text">
                <img src={logo} alt="Logo" height={32} width={32} />
                <Typography variant="h6">Pollerama</Typography>
              </StyledButton>
            </LogoAndTitle>
          </HeaderCenterSection>
          <HeaderRightSection>
            <IconButton color="inherit" onClick={() => setSearchOpen(true)}>
              <SearchIcon />
            </IconButton>
            <NotificationBell />
            <IconButton color="inherit" onClick={() => navigate("/messages")} sx={{ mr: 1 }}>
              <Badge badgeContent={unreadTotal} color="primary" invisible={unreadTotal === 0}>
                <MailIcon />
              </Badge>
            </IconButton>
            <UserMenu />
          </HeaderRightSection>
        </Toolbar>
      </StyledAppBar>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
};

export default Header;
