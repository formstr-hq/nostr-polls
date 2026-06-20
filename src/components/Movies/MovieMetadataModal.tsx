import React, { useEffect, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Modal,
  TextField,
  Typography,
  Tabs,
  Tab,
  Divider,
} from "@mui/material";
import { signEvent } from "../../nostr";
import { Event } from "nostr-tools";
import MovieCard from "./MovieCard";
import { useBackClose } from "../../hooks/useBackClose";
import { dataLayer } from "@formstr/local-relay";
import { usePublishDiagnostic } from "../../hooks/usePublishDiagnostic";
import { PublishDiagnosticModal } from "../Common/PublishDiagnosticModal";

const GENRE_SUGGESTIONS = [
  "action", "adventure", "animation", "biography", "comedy", "crime",
  "documentary", "drama", "fantasy", "history", "horror", "music",
  "mystery", "romance", "sci-fi", "sport", "thriller", "war", "western",
];

interface MovieMetadataModalProps {
  open: boolean;
  onClose: () => void;
  imdbId: string;
}

const MovieMetadataModal: React.FC<MovieMetadataModalProps> = ({
  open,
  onClose,
  imdbId,
}) => {
  const [title, setTitle] = useState("");
  const [poster, setPoster] = useState("");
  const [year, setYear] = useState("");
  const [summary, setSummary] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [tab, setTab] = useState(0);
  const [previewEvent, setPreviewEvent] = useState<Event>();
  const { result, open: diagOpen, setOpen: setDiagOpen, title: diagTitle, openModal, retry } = usePublishDiagnostic();
  useBackClose(open, onClose);

  const fetchFallbackMovieMetadata = async (imdbId: string) => {
    const cacheKey = `movie-fallback:${imdbId}`;
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        localStorage.removeItem(cacheKey);
      }
    }

    const sparql = `
SELECT ?itemLabel ?year ?article
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres)
WHERE {
  ?item wdt:P345 "${imdbId}".
  OPTIONAL { ?item wdt:P577 ?year. }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  OPTIONAL {
    ?item wdt:P136 ?genre.
    ?genre rdfs:label ?genreLabel.
    FILTER(LANG(?genreLabel) = "en")
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?itemLabel ?year ?article
LIMIT 1
`;
    const wikiDataUrl = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
    const wikiDataRes = await fetch(wikiDataUrl);
    const wikiData = await wikiDataRes.json();

    const result = wikiData?.results?.bindings?.[0];
    if (!result?.itemLabel?.value) return null;

    const title = result.itemLabel.value;
    const year = result.year?.value?.slice(0, 4) || "";

    const articleUrl = result.article?.value;
    const wikiTitle = articleUrl
      ? articleUrl.split("/wiki/")[1]
      : encodeURIComponent(title.replace(/ /g, "_"));
    const wikiRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${wikiTitle}`
    );

    const wiki = await wikiRes.json();

    const fallback = {
      title,
      year,
      poster: wiki.thumbnail?.source || "",
      summary: wiki.extract || "",
      genres: result.genres?.value
        ? result.genres.value.split("|").map((g: string) =>
            g.toLowerCase().trim().replace(/\s+films?$/i, "").trim()
          ).filter(Boolean)
        : [],
    };

    localStorage.setItem(cacheKey, JSON.stringify(fallback));
    return fallback;
  };

  useEffect(() => {
    if (!open) return;

    const initialize = async () => {
      const fallback = await fetchFallbackMovieMetadata(imdbId);

      if (fallback) {
        setTitle((prev) => prev || fallback.title);
        setPoster((prev) => prev || fallback.poster);
        setYear((prev) => prev || fallback.year);
        setSummary((prev) => prev || fallback.summary);
        setGenres((prev) => prev.length ? prev : (fallback.genres ?? []));
      }

      setPreviewEvent(await buildPreviewEvent());
    };

    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imdbId]);

  const buildTags = () => [
    ["d", `movie:${imdbId}`],
    ...(poster ? [["poster", poster]] : []),
    ...(year ? [["year", year]] : []),
    ...(summary ? [["summary", summary]] : []),
    ...genres.map((g) => ["g", g]),
  ];

  const buildPreviewEvent = async (): Promise<Event> => {
    return {
      id: "Random",
      kind: 30300,
      content: title || "Untitled",
      tags: buildTags(),
      created_at: Math.floor(Date.now() / 1000),
      pubkey: "placeholder_pubkey",
      sig: "placeholder_signature",
    };
  };

  const handlePublish = async () => {
    const event = {
      kind: 30300,
      content: title || "Untitled",
      tags: buildTags(),
      created_at: Math.floor(Date.now() / 1000),
    };

    const signed = await signEvent(event);
    if (!signed) throw new Error("Signing failed");

    onClose();
    const publishResult = await dataLayer.publishEvent(signed);
    openModal(signed, publishResult, "Movie metadata publish results");
  };

  const renderEditTab = () => (
    <>
      <TextField
        fullWidth
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        sx={{ mb: 2 }}
      />
      <TextField
        fullWidth
        label="Poster URL"
        value={poster}
        onChange={(e) => setPoster(e.target.value)}
        sx={{ mb: 2 }}
      />
      <TextField
        fullWidth
        label="Year"
        value={year}
        onChange={(e) => setYear(e.target.value)}
        sx={{ mb: 2 }}
      />
      <TextField
        fullWidth
        multiline
        rows={3}
        label="Summary"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        sx={{ mb: 2 }}
      />
      <Autocomplete
        multiple
        freeSolo
        options={GENRE_SUGGESTIONS}
        value={genres}
        onChange={(_, newValue) =>
          setGenres(newValue.map((v) => v.toLowerCase().trim()).filter(Boolean))
        }
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip label={option} size="small" {...getTagProps({ index })} key={option} />
          ))
        }
        renderInput={(params) => (
          <TextField {...params} label="Genres" placeholder="Add genre…" />
        )}
        sx={{ mb: 2 }}
      />
      <Box sx={{ display: "flex", gap: 2 }}>
        <Button fullWidth variant="contained" onClick={handlePublish}>
          Publish
        </Button>
        <Button fullWidth variant="outlined" onClick={() => setTab(1)}>
          Preview
        </Button>
      </Box>
    </>
  );

  const renderPreviewTab = () => (
    <>
      <Typography variant="subtitle2" gutterBottom>
        Preview:
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <MovieCard imdbId={imdbId} metadataEvent={previewEvent} />
      <Button
        fullWidth
        variant="outlined"
        sx={{ mt: 2 }}
        onClick={() => setTab(0)}
      >
        Back to Edit
      </Button>
    </>
  );

  return (
    <>
      <Modal open={open} onClose={onClose}>
        <Box
          sx={{
            p: 4,
            bgcolor: "background.paper",
            borderRadius: 2,
            boxShadow: 24,
            maxWidth: 600,
            mx: "auto",
            mt: "5%",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Typography variant="h6">Add Movie Metadata</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
            IMDb ID: <code>{imdbId}</code>
          </Typography>

          <Tabs value={tab} onChange={(_, val) => setTab(val)} sx={{ mb: 2 }}>
            <Tab label="Edit" />
            <Tab label="Preview" />
          </Tabs>

          {tab === 0 ? renderEditTab() : renderPreviewTab()}
        </Box>
      </Modal>
      {result && (
        <PublishDiagnosticModal
          open={diagOpen}
          onClose={() => setDiagOpen(false)}
          title={diagTitle}
          entries={result.relayResults}
          onRetry={retry}
        />
      )}
    </>
  );
};

export default MovieMetadataModal;
