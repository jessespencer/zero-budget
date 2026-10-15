import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/setup/render";
import { AboutDialog } from "@/components/shared/about-dialog";
import { REPO_URL, releaseUrl } from "@/lib/version";

describe("AboutDialog", () => {
  it("shows the AGPL notice, copyright and no-warranty disclaimer", () => {
    renderWithProviders(<AboutDialog open onOpenChange={() => {}} />);

    expect(screen.getByRole("heading", { name: "About Zero" })).toBeInTheDocument();
    expect(screen.getByText(/GNU AGPL v3/)).toBeInTheDocument();
    expect(screen.getByText(/no warranty/)).toBeInTheDocument();
    expect(screen.getByText(/^Copyright/)).toBeInTheDocument();
  });

  it("links out to the source, license and issues in a new tab", () => {
    renderWithProviders(<AboutDialog open onOpenChange={() => {}} />);

    const source = screen.getByRole("link", { name: /Source code/ });
    expect(source).toHaveAttribute("href", REPO_URL);
    expect(source).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: /License/ })).toHaveAttribute(
      "href",
      `${REPO_URL}/blob/main/LICENSE`
    );
    expect(screen.getByRole("link", { name: /Report an issue/ })).toHaveAttribute(
      "href",
      `${REPO_URL}/issues`
    );
  });
});

describe("releaseUrl", () => {
  it("points a release build at its own tag", () => {
    expect(releaseUrl("1.2.3")).toBe(`${REPO_URL}/releases/tag/v1.2.3`);
  });

  it("falls back to the releases list for a dev build", () => {
    expect(releaseUrl("dev")).toBe(`${REPO_URL}/releases`);
  });
});
