// Private, per-user pages: keep them out of search indexes.
export const metadata = { robots: { index: false, follow: false } };

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
