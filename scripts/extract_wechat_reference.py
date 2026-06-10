import html
import re
import urllib.request


URL = "https://mp.weixin.qq.com/s/LunwF1WTYb5Ci4AOTNlZBA"

req = urllib.request.Request(
    URL,
    headers={
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/125.0 Safari/537.36"
        )
    },
)
s = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
decoded = (
    s.replace("\\x22", '"')
    .replace("\\x26", "&")
    .replace("\\x3c", "<")
    .replace("\\x3e", ">")
    .replace("\\x3d", "=")
    .replace("\\x2f", "/")
)

title = re.search(r'<span class="js_title_inner">(.*?)</span>', s, re.S)
name = re.search(r'id="js_name">\s*(.*?)\s*</a>', s, re.S)
print("TITLE:", html.unescape(re.sub(r"<[^>]+>", "", title.group(1))).strip() if title else "")
print("ACCOUNT:", html.unescape(re.sub(r"<[^>]+>", "", name.group(1))).strip() if name else "")

for pat in ["空间智能", "峥嵘", "中信证券", "飞渡科技", "data-desc"]:
    idx = decoded.find(pat)
    print("FOUND", pat, idx)
    if idx >= 0:
        print(decoded[max(0, idx - 300) : idx + 500])

start = decoded.find('id="js_content"')
end = decoded.find("js_sg_bar", start)
cont = decoded[start:end] if start >= 0 and end > start else ""
cont = re.sub(r"<br[^>]*>", "\n", cont)
cont = re.sub(r"</(?:p|section|h\d|div)>", "\n", cont)
text = re.sub(r"<[^>]+>", "", cont)
text = html.unescape(text)
lines = [line.strip() for line in text.splitlines() if line.strip()]

print("\nTEXT_SAMPLE:")
for line in lines[:180]:
    print(line)

print("\nSTYLE_HINTS:")
for key in [
    "font-size",
    "letter-spacing",
    "background",
    "border",
    "linear-gradient",
    "rgb(",
    "#",
]:
    print(key, cont.count(key))
