import React, { useEffect, useRef, useState } from "react";
import { Fab, Zoom } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useNavigate, useLocation } from "react-router-dom";

const CreateFAB: React.FC = () => {
  const [visible, setVisible] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(false);

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        setVisible(true);
      }, 300);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const handleClick = () => {
    if (location.pathname.startsWith("/feeds/polls")) {
      navigate("/create?type=poll");
    } else {
      // Pre-fill hashtag from topics feed
      const match = location.pathname.match(/\/feeds\/topics\/(.+)/);
      if (match) {
        navigate(`/create?hashtag=${encodeURIComponent(match[1])}`);
      } else {
        navigate("/create");
      }
    }
  };

  return (
    <Zoom in={visible}>
      <Fab
        color="primary"
        onClick={handleClick}
        sx={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 1000,
        }}
      >
        <AddIcon />
      </Fab>
    </Zoom>
  );
};

export default CreateFAB;
