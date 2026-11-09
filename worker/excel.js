(() => {
  const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const worksheetPath = "xl/worksheets/sheet1.xml";
  const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
  const maxFileSize = 5 * 1024 * 1024;
  const editable = labels.flatMap((label, day) => times.map((time, slot) => ({
    ref: "BCD"[day] + (slot + 5), day, slot, label: label + " · " + time,
  }))).concat({ref: "A24", day: 0, slot: -1, label: "공용 메모"});

  const elements = (node, tag) => Array.from(node.getElementsByTagNameNS(namespace, tag));
  const child = (node, tag) => Array.from(node.children).find(element => element.localName === tag);
  const cells = doc => new Map(elements(doc, "c").map(cell => [cell.getAttribute("r"), cell]));
  const textValue = node => Array.from(node.children)
    .map(element => element.localName === "r" ? child(element, "t")?.textContent : element.localName === "t" ? element.textContent : "")
    .join("").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  const noteAt = (snapshot, day, slot) => slot === -1 ? snapshot.memo : snapshot.days[day][slot];
  const status = message => { $("excel-status").textContent = message; };
  const formatError = "엑셀 날짜·시간 배치가 원본 양식과 다릅니다. 사이트에서 내보낸 양식을 사용해 주세요.";
  let pending = [];
  let applying = false;

  async function readXml(zip, path) {
    const file = zip.file(path);
    if (!file || file._data.uncompressedSize > maxFileSize) throw Error(formatError);
    const doc = new DOMParser().parseFromString(await file.async("string"), "application/xml");
    if (doc.doctype || doc.getElementsByTagName("parsererror").length) throw Error("엑셀 파일 구조를 읽을 수 없어요.");
    return doc;
  }

  async function readWorkbook(file) {
    if (!/\.xlsx$/i.test(file.name) || file.size > maxFileSize) throw Error("5MB 이하의 .xlsx 파일을 선택해 주세요.");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const book = await readXml(zip, "xl/workbook.xml");
    const sheets = elements(book, "sheet");
    const sheet = sheets.find(item => item.getAttribute("name") === "가이드") ?? sheets[0];
    const rels = await readXml(zip, "xl/_rels/workbook.xml.rels");
    const relation = Array.from(rels.documentElement.children)
      .find(item => item.getAttribute("Id") === sheet?.getAttributeNS(relationships, "id"));
    const target = relation?.getAttribute("Target");
    if (!target || !relation.getAttribute("Type")?.endsWith("/worksheet") || relation.getAttribute("TargetMode") === "External") {
      throw Error(formatError);
    }
    const sheetUrl = new URL(target, "https://xlsx.invalid/xl/workbook.xml");
    if (sheetUrl.origin !== "https://xlsx.invalid") throw Error(formatError);
    const grid = cells(await readXml(zip, sheetUrl.pathname.slice(1)));
    const strings = zip.file("xl/sharedStrings.xml")
      ? elements(await readXml(zip, "xl/sharedStrings.xml"), "si").map(textValue)
      : [];
    function value(ref) {
      const cell = grid.get(ref);
      if (!cell) return "";
      const type = cell.getAttribute("t");
      if (child(cell, "f") || type === "e") throw Error(ref + " 셀에 수식 또는 오류가 있습니다. 텍스트로 입력해 주세요.");
      const raw = child(cell, "v")?.textContent ?? "";
      if (type === "s") {
        if (!/^\d+$/.test(raw) || strings[Number(raw)] === undefined) throw Error(formatError);
        return strings[Number(raw)].trim();
      }
      if (type === "inlineStr") return textValue(child(cell, "is") ?? cell).trim();
      return raw.trim();
    }
    const normal = text => text.replace(/\s/g, "").replace(/[–—~]/g, "-");
    const validDates = labels.every((label, index) => normal(value("BCD"[index] + "4")) === normal(label));
    const validTimes = times.every((time, index) => normal(value("A" + (index + 5))) === normal(time));
    if (!validDates || !validTimes) throw Error(formatError);
    return editable.map(cell => {
      const note = value(cell.ref);
      if (note.length > 2000) throw Error(cell.ref + " 셀은 최대 2,000자까지 가져올 수 있어요.");
      return {...cell, note};
    });
  }

  async function latestSchedule() {
    const response = await fetch("/api/schedule");
    if (!response.ok) throw Error("현재 일정을 불러오지 못했어요.");
    return response.json();
  }

  $("excel-tools").hidden = false;
  $("excel-export").onclick = async () => {
    $("excel-export").disabled = true;
    try {
      const [snapshot, response] = await Promise.all([latestSchedule(), fetch("/assets/schedule-template.xlsx")]);
      if (!response.ok) throw Error("엑셀 양식을 불러오지 못했어요.");
      const zip = await JSZip.loadAsync(await response.arrayBuffer());
      const doc = await readXml(zip, worksheetPath);
      const grid = cells(doc);
      for (const {ref, day, slot} of editable) {
        const cell = grid.get(ref);
        const note = noteAt(snapshot, day, slot).note;
        cell.replaceChildren();
        cell.removeAttribute("t");
        if (!note) continue;
        cell.setAttribute("t", "inlineStr");
        const inline = doc.createElementNS(namespace, "is");
        const text = doc.createElementNS(namespace, "t");
        text.setAttributeNS(xmlNamespace, "xml:space", "preserve");
        text.textContent = note.replace(/_(?=x[0-9a-f]{4}_)/gi, "_x005F_")
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g,
            character => "_x" + character.charCodeAt(0).toString(16).padStart(4, "0") + "_");
        inline.append(text);
        cell.append(inline);
      }
      zip.file(worksheetPath, new XMLSerializer().serializeToString(doc));
      const blob = await zip.generateAsync({type: "blob", compression: "DEFLATE",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
      const url = URL.createObjectURL(blob);
      const download = document.createElement("a");
      download.href = url;
      download.download = "광저우_웨딩_일정표.xlsx";
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status("현재 일정과 공용 메모를 엑셀로 내보냈어요.");
    } catch (error) { status(error.message || "엑셀을 내보내지 못했어요."); }
    finally { $("excel-export").disabled = false; }
  };

  $("excel-import").onclick = () => $("excel-file").click();
  $("excel-file").onchange = async () => {
    const file = $("excel-file").files[0];
    $("excel-file").value = "";
    if (!file) return;
    $("excel-import").disabled = true;
    try {
      const [incoming, snapshot] = await Promise.all([readWorkbook(file), latestSchedule()]);
      const changes = incoming.flatMap(({ref, label, day, slot, note}) => {
        const current = noteAt(snapshot, day, slot);
        return current.note === note ? [] : [{ref, label, day, slot, note, previous: current.note, revision: current.revision}];
      });
      if (!changes.length) { status("엑셀과 현재 일정이 같아요."); return; }
      pending = changes.map(({day, slot, note, revision}) => ({day, slot, note, revision}));
      $("excel-summary").textContent = changes.length + "개 칸이 변경됩니다. 빈 칸으로 가져오면 기존 내용이 지워집니다.";
      $("excel-changes").replaceChildren(...changes.map(change => {
        const item = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent = change.label + " (" + change.ref + ")";
        item.append(title, "\n현재 · " + (change.previous || "비어 있음") + "\n엑셀 · " + (change.note || "비우기"));
        return item;
      }));
      $("excel-error").textContent = "";
      $("excel-apply").disabled = false;
      $("excel-preview").showModal();
    } catch (error) { status(error.message || "엑셀을 읽지 못했어요."); }
    finally { $("excel-import").disabled = false; }
  };
  $("excel-cancel").onclick = () => $("excel-preview").close();
  $("excel-preview").addEventListener("cancel", event => { if (applying) event.preventDefault(); });
  $("excel-apply").onclick = async () => {
    if (applying || !pending.length) return;
    applying = true;
    $("excel-apply").disabled = $("excel-cancel").disabled = true;
    let stale = false;
    try {
      const response = await fetch("/api/schedule", {method: "POST",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({edits: pending})});
      stale = response.status === 409;
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (data) {
        for (const cell of result.cells) {
          if (cell.slot === -1) data.memo = cell;
          else data.days[cell.day][cell.slot] = cell;
        }
        render();
      }
      status(result.cells.length + "개 칸을 저장했어요. 공개 일정에도 반영됐습니다.");
      pending = [];
      $("excel-preview").close();
      void load();
    } catch (error) { $("excel-error").textContent = error.message || "엑셀 일정을 저장하지 못했어요."; }
    finally {
      applying = false;
      $("excel-cancel").disabled = false;
      $("excel-apply").disabled = stale;
    }
  };
})();
