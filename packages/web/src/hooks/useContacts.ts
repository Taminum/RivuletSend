import { useCallback, useEffect, useState } from "react";
import { api, type ContactsResponse } from "../api";

export function useContacts() {
  const [data, setData] = useState<ContactsResponse | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await api.listContacts());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(
    async (arg: { email?: string; userId?: string }) => {
      await api.addContact(arg);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (userId: string) => {
      await api.deleteContact(userId);
      await reload();
    },
    [reload],
  );

  return { data, loadError, reload, add, remove };
}
