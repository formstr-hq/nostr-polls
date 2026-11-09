import React, { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Modal,
  TextField,
  Typography,
} from "@mui/material";
import MovieCard from "../Movies/MovieCard";
import { useBackClose } from "../../hooks/useBackClose";

interface WikidataResult {
  label: string;
  imdbId: string;
  poster?: string;
  year?: string;
}

async function searchWikidata(term: string): Promise<WikidataResult[]> {
  const safe = term.replace(/["\\]/g, "");
  // Use wikibase:mwapi EntitySearch — hits the search index instead of
  // table-scanning all items, so results come back in ~1s instead of timing out.
  const query = `
    SELECT DISTINCT ?item ?itemLabel ?imdb ?poster ?year WHERE {
      SERVICE wikibase:mwapi {
        bd:serviceParam wikibase:endpoint "www.wikidata.org";
                        wikibase:api "EntitySearch";
                        mwapi:search "${safe}";
                        mwapi:language "en".
        ?item wikibase:apiOutputItem mwapi:item.
      }
      ?item wdt:P345 ?imdb.
      OPTIONAL { ?item wdt:P18 ?poster. }
      OPTIONAL { ?item wdt:P577 ?year. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 8
  `;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();
    return (data.results.bindings as any[])
      .map((b) => ({
        label: b.itemLabel?.value || "",
        imdbId: b.imdb?.value || "",
        poster: b.poster?.value,
        year: b.year?.value ? b.year.value.slice(0, 4) : undefined,
      }))
      .filter((r) => /^tt\d{7,}$/.test(r.imdbId));
  } finally {
    clearTimeout(timeout);
  }
}

interface RateMovieModalProps {
  open: boolean;
  onClose: () => void;
  onRated?: (imdbId: string) => void;
}

const RateMovieModal: React.FC<RateMovieModalProps> = ({ open, onClose, onRated }) => {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<WikidataResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedImdbId, setSelectedImdbId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useBackClose(open, onClose);

  const isImdbId = (v: string) => /^tt\d{7,}$/.test(v.trim());

  const handleInputChange = (value: string) => {
    setInput(value);
    setSelectedImdbId(null);
    setResults([]);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    if (!trimmed || isImdbId(trimmed)) return;

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchWikidata(trimmed));
      } catch {
        // network error — leave results empty
      } finally {
        setSearching(false);
      }
    }, 500);
  };

  const handleSelectResult = (imdbId: string) => {
    setSelectedImdbId(imdbId);
    setResults([]);
  };

  const handleLoadDirect = () => {
    const trimmed = input.trim();
    if (isImdbId(trimmed)) setSelectedImdbId(trimmed);
  };

  const handleClose = () => {
    if (selectedImdbId && onRated) onRated(selectedImdbId);
    setInput("");
    setResults([]);
    setSelectedImdbId(null);
    onClose();
  };

  // Clean up debounce on unmount
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  return (
    <Modal open={open} onClose={handleClose}>
      <Box
        sx={{
          p: { xs: 2, sm: 4 },
          bgcolor: "background.paper",
          borderRadius: 2,
          boxShadow: 24,
          // Side margins on phones (it used to run edge to edge), and dvh so the
          // on-screen keyboard / URL bar don't push it off screen.
          width: "calc(100% - 32px)",
          maxWidth: 500,
          mx: "auto",
          mt: "10%",
          maxHeight: "80dvh",
          overflowY: "auto",
        }}
      >
        <Typography variant="h6" mb={2}>
          Rate a Movie
        </Typography>

        {!selectedImdbId ? (
          <>
            <TextField
              fullWidth
              label="Search by title or paste IMDb ID (e.g. tt1375666)"
              variant="outlined"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              sx={{ mb: 1 }}
              autoFocus
            />

            {/* Direct IMDb ID load button — shown only when input looks like an ID */}
            {isImdbId(input.trim()) && (
              <Button variant="contained" fullWidth onClick={handleLoadDirect} sx={{ mb: 1 }}>
                Load Movie
              </Button>
            )}

            {searching && (
              <Box display="flex" justifyContent="center" py={2}>
                <CircularProgress size={24} />
              </Box>
            )}

            {results.length > 0 && (
              <List disablePadding>
                {results.map((r) => (
                  <ListItemButton
                    key={r.imdbId}
                    onClick={() => handleSelectResult(r.imdbId)}
                    sx={{ borderRadius: 1, mb: 0.5 }}
                  >
                    <ListItemAvatar>
                      <Avatar
                        src={r.poster}
                        variant="rounded"
                        sx={{ width: 36, height: 54, mr: 1 }}
                      />
                    </ListItemAvatar>
                    <ListItemText
                      primary={r.label}
                      secondary={r.year ? `${r.year} · ${r.imdbId}` : r.imdbId}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </>
        ) : (
          <>
            <MovieCard imdbId={selectedImdbId} />
            <Button variant="outlined" fullWidth sx={{ mt: 2 }} onClick={handleClose}>
              Close
            </Button>
          </>
        )}
      </Box>
    </Modal>
  );
};

export default RateMovieModal;
