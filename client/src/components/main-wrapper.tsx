"use client";

import { PropsWithChildren, ReactNode } from "react";
import Header from "./header";

const MainWrapper = ({
  children,
  action,
}: PropsWithChildren<{ action?: ReactNode }>) => {
  return (
    <section className="flex min-h-full min-w-0 flex-1 flex-col">
      <Header action={action} />
      <div className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-8">{children}</div>
    </section>
  );
};

export default MainWrapper;
