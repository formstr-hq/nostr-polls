import { createContext, ReactNode, useEffect, useRef, useState } from "react";
import { LoginModal } from "../components/Login/LoginModal";
import {
  PassphraseModal,
  PassphraseModalMode,
} from "../components/Login/PassphraseModal";
import { signerManager, StoredAccount } from "../singletons/Signer/SignerManager";

export type User = {
  name?: string;
  picture?: string;
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
  resolve: (passphrase: string | null) => void;
};

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => signerManager.getUser());
  const [accounts, setAccounts] = useState<StoredAccount[]>(() =>
    signerManager.getAccounts(),
  );
  const [loginModalOpen, setLoginModalOpen] = useState<boolean>(false);
  const [passphraseRequest, setPassphraseRequest] =
    useState<PassphraseRequest | null>(null);
  // Pending login-modal resolver so SignerManager.getSigner() can await the
  // user finishing the login flow.
  const loginResolverRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    signerManager.registerLoginModal(() => {
      return new Promise<void>((resolve) => {
        loginResolverRef.current = resolve;
        setLoginModalOpen(true);
      });
    });

    signerManager.registerPassphraseCallback((req) => {
      return new Promise<string | null>((resolve) => {
        setPassphraseRequest({
          mode: req.kind === "unlock" ? "unlock" : "migrate",
          pubkey: req.pubkey,
          resolve,
        });
      });
    });

    signerManager.onChange(() => {
      setUser((prev) => {
        const next = signerManager.getUser();
        if (next?.pubkey && next.pubkey === prev?.pubkey) return prev;
        return next;
      });
      setAccounts([...signerManager.getAccounts()]);
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
    const req = passphraseRequest;
    setPassphraseRequest(null);
    if (req) req.resolve(passphrase);
  };

  const handlePassphraseCancel = () => {
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
        onSubmit={handlePassphraseSubmit}
        onCancel={handlePassphraseCancel}
      />
    </UserContext.Provider>
  );
}
