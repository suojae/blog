document.documentElement.setAttribute("saved-theme", "dark")
localStorage.setItem("theme", "dark")

const emitThemeChangeEvent = (theme: "light" | "dark") => {
  const event: CustomEventMap["themechange"] = new CustomEvent("themechange", {
    detail: { theme },
  })
  document.dispatchEvent(event)
}

document.addEventListener("nav", () => {
  document.documentElement.setAttribute("saved-theme", "dark")
  emitThemeChangeEvent("dark")
})
