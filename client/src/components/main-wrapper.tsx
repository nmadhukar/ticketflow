"use client";

import { PropsWithChildren, ReactNode } from "react";
import Header from "./header";

const MainWrapper = ({
  children,
  action,
}: PropsWithChildren<{ action?: ReactNode }>) => {
  return (
    <section className="flex-1 flex flex-col">
      <Header action={action} />{" "}
      <div className="flex-1 p-6 overflow-y-auto bg-background">{children}</div>
    </section>
  );
};

export default MainWrapper;
