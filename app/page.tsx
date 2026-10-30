import { Suspense } from "react";

import Workspace from "@/components/Workspace";

export default function Page() {
  return (
    <Suspense fallback={<div className="main loading">Loading</div>}>
      <Workspace />
    </Suspense>
  );
}
