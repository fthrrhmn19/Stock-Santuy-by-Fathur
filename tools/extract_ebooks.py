from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".ebook_work" / "source"
TEXT_OUT = ROOT / ".ebook_work" / "texts"
MANIFEST = ROOT / ".ebook_work" / "ebook_manifest.json"


def slugify(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower()
    return slug[:120] or "ebook"


def page_text(page) -> str:
    try:
        return page.extract_text() or ""
    except Exception as exc:  # pypdf can fail on malformed page objects.
        return f"[PAGE_EXTRACTION_ERROR: {type(exc).__name__}: {exc}]"


def main() -> None:
    TEXT_OUT.mkdir(parents=True, exist_ok=True)
    manifest = []

    for pdf in sorted(SOURCE.glob("*.pdf"), key=lambda p: p.name.lower()):
        item = {
            "file": pdf.name,
            "path": str(pdf),
            "text_file": None,
            "pages": 0,
            "chars": 0,
            "readable_pages": 0,
            "status": "pending",
            "error": None,
        }
        out = TEXT_OUT / f"{slugify(pdf.stem)}.txt"
        try:
            reader = PdfReader(str(pdf))
            if reader.is_encrypted:
                try:
                    reader.decrypt("")
                except Exception:
                    item["status"] = "encrypted"
                    item["error"] = "Encrypted PDF could not be decrypted with empty password."
                    manifest.append(item)
                    continue

            chunks = []
            for i, page in enumerate(reader.pages, start=1):
                text = page_text(page).replace("\x00", "")
                clean = re.sub(r"[ \t]+", " ", text).strip()
                if clean:
                    item["readable_pages"] += 1
                item["chars"] += len(clean)
                chunks.append(f"\n\n=== PAGE {i} ===\n{clean}\n")

            item["pages"] = len(reader.pages)
            out.write_text("".join(chunks), encoding="utf-8", errors="replace")
            item["text_file"] = str(out)
            item["status"] = "readable" if item["chars"] >= 500 else "low_text"
        except Exception as exc:
            item["status"] = "failed"
            item["error"] = f"{type(exc).__name__}: {exc}"
        manifest.append(item)

    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({
        "pdfs": len(manifest),
        "readable": sum(1 for item in manifest if item["status"] == "readable"),
        "low_text": sum(1 for item in manifest if item["status"] == "low_text"),
        "failed": sum(1 for item in manifest if item["status"] == "failed"),
        "encrypted": sum(1 for item in manifest if item["status"] == "encrypted"),
        "manifest": str(MANIFEST),
    }, indent=2))


if __name__ == "__main__":
    main()
