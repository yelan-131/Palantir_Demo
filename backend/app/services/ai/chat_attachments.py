"""Extract bounded excerpts from files attached to an AI chat turn."""

import csv
import io
from pathlib import PurePosixPath
from threading import Lock
from xml.etree import ElementTree
from zipfile import ZipFile

import pymupdf
from openpyxl import load_workbook

MAX_FILE_BYTES = 768 * 1024
MAX_EXCERPT_CHARS = 2000
MAX_SHEETS = 5
MAX_ROWS = 12
MAX_COLUMNS = 50
MAX_PDF_PAGES = 20
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
PDF_PARSE_LOCK = Lock()


def _check_archive_size(archive: ZipFile, label: str) -> None:
    entries = archive.infolist()
    if len(entries) > 1000 or sum(entry.file_size for entry in entries) > 16 * 1024 * 1024:
        raise ValueError(f"{label} 解压后超过大小限制")


def _excel_excerpt(content: bytes) -> tuple[str, bool]:
    with ZipFile(io.BytesIO(content)) as archive:
        _check_archive_size(archive, "Excel")
    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True, keep_links=False)
    try:
        output = io.StringIO()
        writer = csv.writer(output)
        sampled = len(workbook.worksheets) > MAX_SHEETS
        for sheet in workbook.worksheets[:MAX_SHEETS]:
            sampled |= (sheet.max_row or 0) > MAX_ROWS or (sheet.max_column or 0) > MAX_COLUMNS
            has_values = False
            rows = sheet.iter_rows(max_row=MAX_ROWS + 1, max_col=MAX_COLUMNS + 1, values_only=True)
            for index, row in enumerate(rows, start=1):
                cells = list(row)
                while cells and cells[-1] is None:
                    cells.pop()
                if not cells:
                    continue
                if index > MAX_ROWS:
                    sampled = True
                    break
                sampled |= len(cells) > MAX_COLUMNS
                if not has_values:
                    output.write(f"工作表：{sheet.title}\n")
                    has_values = True
                writer.writerow(cells[:MAX_COLUMNS])
        return output.getvalue(), sampled
    finally:
        workbook.close()


def _word_excerpt(content: bytes) -> tuple[str, bool]:
    with ZipFile(io.BytesIO(content)) as archive:
        _check_archive_size(archive, "Word")
        with archive.open("word/document.xml") as document:
            output = io.StringIO()
            for _, paragraph in ElementTree.iterparse(document, events=("end",)):
                if paragraph.tag != WORD_NS + "p":
                    continue
                text = "".join(node.text or "" for node in paragraph.iter(WORD_NS + "t")).strip()
                paragraph.clear()
                if not text:
                    continue
                if output.tell():
                    output.write("\n")
                remaining = MAX_EXCERPT_CHARS - output.tell()
                if len(text) > remaining:
                    output.write(text[:max(0, remaining)])
                    return output.getvalue(), True
                output.write(text)
            return output.getvalue(), False


def _pdf_excerpt(content: bytes) -> tuple[str, bool]:
    with PDF_PARSE_LOCK, pymupdf.open(stream=content, filetype="pdf") as document:
        if document.needs_pass:
            raise ValueError("PDF 有密码保护，请解锁后重新添加")
        output = io.StringIO()
        page_count = min(document.page_count, MAX_PDF_PAGES)
        for index in range(page_count):
            text = document[index].get_text(sort=True).strip()
            if not text:
                continue
            if output.tell():
                output.write("\n\n")
            remaining = MAX_EXCERPT_CHARS - output.tell()
            if len(text) > remaining:
                output.write(text[:max(0, remaining)])
                return output.getvalue(), True
            output.write(text)
        if not output.tell():
            raise ValueError(f"PDF 前 {page_count} 页没有可提取的文字，请上传带文字层的 PDF")
        return output.getvalue(), document.page_count > page_count


DOCUMENT_READERS = {
    ".xlsx": ("Excel", _excel_excerpt),
    ".docx": ("Word", _word_excerpt),
    ".pdf": ("PDF", _pdf_excerpt),
}


def extract_chat_attachment(filename: str, content: bytes) -> dict:
    name = PurePosixPath(filename.replace("\\", "/")).name
    suffix = PurePosixPath(name).suffix.lower()
    if len(content) > MAX_FILE_BYTES:
        raise ValueError("单个附件不能超过 768 KB")
    if not content:
        raise ValueError("附件为空")

    sampled = False
    if suffix in DOCUMENT_READERS:
        label, extract = DOCUMENT_READERS[suffix]
        try:
            text, sampled = extract(content)
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError(f"{label} 无法读取，请检查文件是否为有效的 {suffix}") from exc
    elif suffix in {".txt", ".md", ".csv"}:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeError as exc:
            raise ValueError("CSV 和文本附件请使用 UTF-8 编码") from exc
        if "\x00" in text:
            raise ValueError("附件包含无效的文本内容")
    elif suffix == ".doc":
        raise ValueError("请将旧版 Word（.doc）另存为 .docx 后重新添加")
    else:
        raise ValueError("支持 .pdf、.docx、.xlsx、.csv、.txt 和 .md 文件")

    text = text.strip()
    if not text:
        raise ValueError("附件没有可读取的内容")
    return {
        "name": name[:255],
        "excerpt": text[:MAX_EXCERPT_CHARS],
        "sampled": sampled or len(text) > MAX_EXCERPT_CHARS,
    }
