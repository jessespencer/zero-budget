import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DemoBanner } from "@/components/shared/demo-banner";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("DemoBanner", () => {
  it("shows on the demo with the idle time and a source link", () => {
    process.env.ZERO_DEMO = "1";
    process.env.ZERO_DEMO_IDLE_HOURS = "2";
    render(<DemoBanner />);
    expect(screen.getByRole("status", { name: "Demo" })).toHaveTextContent("reset after 2 hours away");
    expect(screen.getByRole("link", { name: "Get Zero" })).toHaveAttribute("href", expect.stringContaining("github.com"));
  });

  it("stays hidden outside demo mode", () => {
    delete process.env.ZERO_DEMO;
    render(<DemoBanner />);
    expect(screen.queryByRole("status", { name: "Demo" })).not.toBeInTheDocument();
  });

  it("hides on the demo when ZERO_DEMO_BANNER=0, for screen recordings", () => {
    process.env.ZERO_DEMO = "1";
    process.env.ZERO_DEMO_BANNER = "0";
    render(<DemoBanner />);
    expect(screen.queryByRole("status", { name: "Demo" })).not.toBeInTheDocument();
  });
});
