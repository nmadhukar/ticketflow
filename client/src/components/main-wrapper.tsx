"use client";

import { PropsWithChildren, ReactNode } from "react";
import Header from "./header";

interface Props extends PropsWithChildren {
  title: string;
  subTitle: string;
  action?: ReactNode;
}

const MainWrapper = ({ children, title, subTitle, action }: Props) => {
  return (
    <section className="flex-1 flex flex-col">
      <Header title={title} subtitle={subTitle} action={action} />
      <div className="flex-1 p-6 overflow-y-auto bg-primary-foreground">
        {children}
      </div>
    </section>
  );
};

export default MainWrapper;
