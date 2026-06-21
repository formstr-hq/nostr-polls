import { createContext, ReactNode, useEffect, useRef, useState } from "react";
import { LoginModal } from "../components/Login/LoginModal";
import {
  PassphraseModal,
  PassphraseModalMode,
} from "../components/Login/PassphraseModal";
import { signerManager, StoredAccount } from "../singletons/Signer/SignerManager";
import { readCachedContacts } from "../nostr/contactsCache";

export type User = {
  name?: string;
  display_name?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
  pubkey: string;
  privateKey?: string;
  follows?: string[];
  webOfTrust?: Set<string>;
  about?: string;
};

interface UserContextInterface {
  user: User | null;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  requestLogin: () => void;
  accounts: StoredAccount[];
  switchAccount: (pubkey: string) => Promise<void>;
  removeAccount: (pubkey: string) => Promise<void>;
}

export const ANONYMOUS_USER_NAME = "Anon...";

export const UserContext = createContext<UserContextInterface | null>(null);

type PassphraseRequest = {
  mode: PassphraseModalMode;
  pubkey: string;
  error?: string;
  attempt: number;
  resolve: (passphrase: string | null) => void;
};

/**
 * Seed a freshly-resolved user with their persisted contact list so following/
 * network feeds have `follows` from the very first render — the contact list is
 * load-bearing and must never depend on worker/relay timing. lists-context
 * revalidates with anything newer (stale-while-revalidate).
 */
function withCachedFollows(u: User | null): User | null {
  if (!u || (u.follows && u.follows.length > 0)) return u;
  const cached = readCachedContacts(u.pubkey);
  return cached ? ({ ...u, follows: cached.follows } as User) : u;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() =>
    withCachedFollows(signerManager.getUser()),
  );
  const [accounts, setAccounts] = useState<StoredAccount[]>(() =>
    signerManager.getAccounts(),
  );
  const [loginModalOpen, setLoginModalOpen] = useState<boolean>(false);
  const [passphraseRequest, setPassphraseRequest] =
    useState<PassphraseRequest | null>(null);
  const [passphraseSubmitting, setPassphraseSubmitting] = useState(false);
  // Pending login-modal resolver so SignerManager.getSigner() can await the
  // user finishing the login flow.
  const loginResolverRef = useRef<(() => void) | null>(null);
  // Cancel pressed while a submitted attempt was still pending. The next
  // passphrase prompt that comes in will be auto-cancelled.
  const autoCancelRef = useRef(false);
  // True between submit and the next prompt/onChange. Used to decide whether
  // a Cancel click aborts the in-flight attempt or just closes the prompt.
  const submittingRef = useRef(false);
  const attemptCounterRef = useRef(0);

  useEffect(() => {
    signerManager.registerLoginModal(() => {
      return new Promise<void>((resolve) => {
        loginResolverRef.current = resolve;
        setLoginModalOpen(true);
      });
    });

    signerManager.registerPassphraseCallback((req) => {
      if (autoCancelRef.current) {
        autoCancelRef.current = false;
        submittingRef.current = false;
        setPassphraseSubmitting(false);
        setPassphraseRequest(null);
        return Promise.resolve(null);
      }
      attemptCounterRef.current += 1;
      const attempt = attemptCounterRef.current;
      submittingRef.current = false;
      setPassphraseSubmitting(false);
      return new Promise<string | null>((resolve) => {
        setPassphraseRequest({
          mode: req.kind === "unlock" ? "unlock" : "migrate",
          pubkey: req.pubkey,
          error: req.error,
          attempt,
          resolve,
        });
      });
    });

    signerManager.onChange(() => {
      setUser((prev) => {
        const next = withCachedFollows(signerManager.getUser());
        if (next?.pubkey && next.pubkey === prev?.pubkey) return prev;
        return next;
      });
      setAccounts([...signerManager.getAccounts()]);
      // A successful unlock fires the package signer's login event, which lands
      // here. If a passphrase prompt was awaiting that unlock, close it.
      if (signerManager.getUser()) {
        submittingRef.current = false;
        setPassphraseSubmitting(false);
        setPassphraseRequest(null);
      }
    });
  }, []);

  const requestLogin = () => setLoginModalOpen(true);

  const switchAccount = async (pubkey: string) => {
    await signerManager.switchAccount(pubkey);
  };

  const removeAccount = async (pubkey: string) => {
    await signerManager.removeAccount(pubkey);
  };

  const handleLoginClose = () => {
    setLoginModalOpen(false);
    // Resolve the pending getSigner() promise so it can check whether a
    // signer is now available (or surface its "no signer" error).
    const resolver = loginResolverRef.current;
    loginResolverRef.current = null;
    if (resolver) resolver();
  };

  const handlePassphraseSubmit = (passphrase: string) => {
    if (!passphraseRequest || submittingRef.current) return;
    submittingRef.current = true;
    setPassphraseSubmitting(true);
    passphraseRequest.resolve(passphrase);
  };

  const handlePassphraseCancel = () => {
    if (submittingRef.current) {
      // Outstanding attempt — close now; auto-cancel the next prompt
      // (in case the in-flight decrypt fails and SignerManager retries).
      autoCancelRef.current = true;
      submittingRef.current = false;
      setPassphraseSubmitting(false);
      setPassphraseRequest(null);
      return;
    }
    const req = passphraseRequest;
    setPassphraseRequest(null);
    if (req) req.resolve(null);
  };

  return (
    <UserContext.Provider
      value={{
        user,
        setUser,
        requestLogin,
        accounts,
        switchAccount,
        removeAccount,
      }}
    >
      {children}
      <LoginModal open={loginModalOpen} onClose={handleLoginClose} />
      <PassphraseModal
        open={passphraseRequest !== null}
        mode={passphraseRequest?.mode ?? "unlock"}
        pubkey={passphraseRequest?.pubkey ?? ""}
        error={passphraseRequest?.error}
        attempt={passphraseRequest?.attempt ?? 0}
        submitting={passphraseSubmitting}
        onSubmit={handlePassphraseSubmit}
        onCancel={handlePassphraseCancel}
      />
    </UserContext.Provider>
  );
}
