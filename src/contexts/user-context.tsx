import { createContext, ReactNode, useEffect, useState } from "react";
import { LoginModal } from "../components/Login/LoginModal";
import { signerManager } from "../singletons/Signer/SignerManager";

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
}

export const ANONYMOUS_USER_NAME = "Anon...";

export const UserContext = createContext<UserContextInterface | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  // Initialise from the signerManager's synchronously-loaded cache so the UI
  // never flashes a "logged out" state while the signer finishes initialising.
  const [user, setUser] = useState<User | null>(() => signerManager.getUser());
  const [loginModalOpen, setLoginModalOpen] = useState<boolean>(false);
  useEffect(() => {
    signerManager.registerLoginModal(() => {
      return new Promise<void>((resolve) => {
        setLoginModalOpen(true);
      });
    });
    signerManager.onChange(() => {
      setUser((prev) => {
        const next = signerManager.getUser();
        // Keep the same object reference when it's the same user so that
        // effects depending on [user] don't fire spuriously (e.g. on signer init).
        if (next?.pubkey && next.pubkey === prev?.pubkey) return prev;
        return next;
      });
    });
  }, []);

  const requestLogin = () => {
    setLoginModalOpen(true);
  };

  return (
    <UserContext.Provider value={{ user, setUser, requestLogin }}>
      {children}
      <LoginModal
        open={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
      />
    </UserContext.Provider>
  );
}
