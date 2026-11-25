import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopyRounded";
import QrCode2Icon from "@mui/icons-material/QrCode2Rounded";
import {
  PaytoTarget,
  buildMoneroUri,
  fetchPaytoTargets,
} from "../../utils/payto";
import { copyToClipboard } from "../../utils/common";
import { useNotification } from "../../contexts/notification-context";
import QrShareDialog from "../Common/QR/QrShareDialog";

interface ProfilePaymentsProps {
  pubkey: string;
  profile: any;
}

interface PaymentRow {
  key: string;
  label: string;
  address: string;
  /** What the QR encodes — a wallet URI where one exists, otherwise the address. */
  qrValue: string;
}

const PAYTO_LABELS: Record<string, string> = {
  bip352: "Bitcoin (silent payments)",
  bip353: "Bitcoin (BIP-353)",
  bitcoin: "Bitcoin",
  cashme: "Cash App",
  ethereum: "Ethereum",
  lightning: "Lightning",
  lnurl: "LNURL (LUD-06)",
  litecoin: "Litecoin",
  monero: "Monero",
  nano: "Nano",
  paypal: "PayPal",
  revolut: "Revolut",
  solana: "Solana",
  venmo: "Venmo",
  zcash: "Zcash",
};

const priority = (type: string) =>
  type === "lightning"
    ? 0
    : type === "lnurl"
      ? 1
      : type === "monero"
        ? 2
        : type === "bitcoin"
          ? 3
          : 4;

function labelForType(type: string): string {
  return PAYTO_LABELS[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

function qrValueFor(type: string, address: string): string {
  switch (type) {
    case "lightning":
    case "lnurl":
      return address.startsWith("lightning:") ? address : `lightning:${address}`;
    case "monero":
      return address.startsWith("monero:") ? address : buildMoneroUri(address);
    case "bitcoin":
      return address.startsWith("bitcoin:") ? address : `bitcoin:${address}`;
    default:
      return address;
  }
}

/**
 * The payment endpoints a profile advertises: LUD-16 lightning address,
 * LUD-06 LNURL, plus every NIP-A3 payto target (Monero, Bitcoin, etc.).
 * Nothing renders when the author published none.
 */
export default function ProfilePayments({ pubkey, profile }: ProfilePaymentsProps) {
  const { showNotification } = useNotification();
  const [targets, setTargets] = useState<PaytoTarget[]>([]);
  const [qrRow, setQrRow] = useState<PaymentRow | null>(null);

  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    setTargets([]);
    fetchPaytoTargets(pubkey)
      .then((next) => {
        if (!cancelled) setTargets(next);
      })
      .catch(() => {
        if (!cancelled) setTargets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: PaymentRow[] = [];

    const add = (type: string, address: string) => {
      const clean = String(address || "").trim();
      if (!clean) return;
      const key = `${type}:${clean}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        key,
        label: labelForType(type),
        address: clean,
        qrValue: qrValueFor(type, clean),
      });
    };

    // LUD-16 is the conventional lightning address in kind-0; LNURL (LUD-06)
    // may be published alongside it.
    if (profile?.lud16) add("lightning", profile.lud16);
    if (profile?.lud06) add("lnurl", profile.lud06);
    for (const target of targets) add(target.type, target.address);

    return out.sort((a, b) => {
      const pa = priority(a.key.split(":")[0]);
      const pb = priority(b.key.split(":")[0]);
      return pa - pb || a.label.localeCompare(b.label);
    });
  }, [profile?.lud16, profile?.lud06, targets]);

  if (rows.length === 0) return null;

  const copy = async (address: string) => {
    try {
      await copyToClipboard(address);
      showNotification("Payment address copied", "success");
    } catch {
      showNotification("Couldn't copy the address.", "error");
    }
  };

  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        Payment targets
      </Typography>
      <Stack spacing={0.25} sx={{ mt: 0.75 }}>
        {rows.map((row) => (
          <Box
            key={row.key}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              minWidth: 0,
              py: 0.5,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                {row.label}
              </Typography>
              <Typography
                variant="body2"
                component="div"
                sx={{
                  fontFamily: "monospace",
                  fontSize: "0.78rem",
                  overflowWrap: "anywhere",
                }}
              >
                {row.address}
              </Typography>
            </Box>
            <Tooltip title="Copy address">
              <IconButton
                size="small"
                onClick={() => copy(row.address)}
                aria-label={`Copy ${row.label} address`}
              >
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Show QR">
              <IconButton
                size="small"
                onClick={() => setQrRow(row)}
                aria-label={`Show ${row.label} QR code`}
              >
                <QrCode2Icon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </Stack>

      <QrShareDialog
        open={qrRow !== null}
        onClose={() => setQrRow(null)}
        title={qrRow?.label || "Payment"}
        subtitle={qrRow ? `Scan to pay with ${qrRow.label}` : undefined}
        value={qrRow?.qrValue || ""}
        displayValue={qrRow?.address}
      />
    </>
  );
}
