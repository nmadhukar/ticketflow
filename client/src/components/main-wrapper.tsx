"use client"

import  { PropsWithChildren } from 'react'
import Header from './header'

interface Props extends PropsWithChildren {
  title:string
  subTitle:string
}

const MainWrapper = ({children,title,subTitle}:Props) => {
  return (
    <div className="flex-1 flex flex-col">
      <Header 
        title={title}
        subtitle={subTitle}
      />  
      <main className="flex-1 p-6 overflow-y-auto">{children}</main>
    </div>
  )
}

export default MainWrapper
