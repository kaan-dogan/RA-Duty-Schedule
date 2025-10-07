(() => {
  const csvPath = "./Thistle - Pollock Duty Calendar.csv";
  

  let rosterData = null;

  const typeColor = (type) => {
    if (!type) return "var(--text-muted)";
    if (type.includes("PG Only Duty")) return "var(--accent-green)";
    return "var(--accent-blue)"; // RA default
  };

  const parseDate = (s) => {
    // Format: DD/MM/YYYY HH:MM
    const [d, m, rest] = s.split("/");
    const [y, time] = rest.split(" ");
    const [hh, mm] = time.split(":");
    return new Date(parseInt(y), parseInt(m)-1, parseInt(d), parseInt(hh), parseInt(mm));
  };

  const splitPeople = (value) => {
    if (!value) return [];
    return value
      .split(/[;,]/)
      .map((name) => name.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  };

  const normalizeName = (name = "") => name.replace(/\s+/g, " ").trim().toLowerCase();

  const loadCSV = () => new Promise((resolve, reject) => {
    Papa.parse(csvPath, {
      download: true,
      header: true,
      complete: (res) => resolve(res.data || []),
      error: reject,
      skipEmptyLines: true,
    });
  });

  const capitalizeWord = (word) => {
    if (!word) return "";
    return word.charAt(0).toUpperCase() + word.slice(1);
  };

  const buildRoster = (rows) => {
    const namesSet = new Set();
    rows.forEach((row) => {
      splitPeople(row["Assigned To"]).forEach((name) => {
        if (name) namesSet.add(name);
      });
    });
    const names = Array.from(namesSet);
    const firstNameMap = new Map();
    const normalizedMap = new Map();
    names.forEach((name) => {
      const normalized = normalizeName(name);
      if (normalized) {
        normalizedMap.set(normalized, name);
      }
      const first = name.split(/\s+/)[0];
      if (!first) return;
      const key = first.toLowerCase();
      const existing = firstNameMap.get(key) || [];
      existing.push(name);
      firstNameMap.set(key, existing);
    });
    const rosterEntries = [];
    names.forEach((name) => {
      const parts = name.split(/\s+/).map((part) => part.toLowerCase());
      if (!parts.length) return;
      rosterEntries.push({ name, parts });
      rosterEntries.push({ name, parts: [parts[0]] });
    });
    rosterEntries.sort((a, b) => b.parts.length - a.parts.length);
    return { names, firstNameMap, normalizedMap, rosterEntries };
  };

  const resolveNameSegments = (name, roster) => {
    if (!name) return [];
    const trimmed = name.replace(/\s+/g, " ").trim();
    if (!trimmed) return [];
    const viaDelimiter = splitPeople(trimmed);
    if (viaDelimiter.length > 1) return viaDelimiter;
    const words = trimmed.split(" ");
    if (words.length <= 2) return [trimmed];
    const parsed = extractPeopleFromTitle(trimmed, roster, { bypassDelimiter: true });
    return parsed.length > 1 ? parsed : [trimmed];
  };

  const canonicalizeName = (name, roster) => {
    const trimmed = (name || "").replace(/\s+/g, " ").trim();
    if (!trimmed) return "";
    const { normalizedMap = new Map(), firstNameMap = new Map() } = roster || {};
    const normalized = normalizeName(trimmed);
    const canonical = normalizedMap.get(normalized);
    if (canonical) {
      if (trimmed.includes(' - ')) {
        const baseCandidate = canonicalizeName(trimmed.split(' - ')[0], roster);
        if (baseCandidate && normalizeName(baseCandidate) !== normalized) {
          return baseCandidate;
        }
      }
      return canonical;
    }
    const hyphenIndex = trimmed.indexOf(" - ");
    if (hyphenIndex > 0) {
      const base = trimmed.slice(0, hyphenIndex).trim();
      const resolved = canonicalizeName(base, roster);
      if (resolved) return resolved;
    }
    const first = trimmed.split(" ")[0];
    if (first) {
      const matches = firstNameMap.get(first.toLowerCase());
      if (matches && matches.length === 1) {
        return matches[0];
      }
    }
    return trimmed;
  };

  const extractPeopleFromTitle = (title, roster, options = {}) => {
    if (!title) return [];
    const { rosterEntries = [] } = roster || {};
    let text = String(title);
    const colonIndex = text.indexOf(":");
    if (colonIndex !== -1) {
      text = text.slice(colonIndex + 1);
    } else {
      text = text.replace(/^RA On Call\s*/i, "");
    }
    text = text.replace(/\band\b/gi, ",");
    text = text.replace(/;/g, ",");
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return [];

    if (!options.bypassDelimiter) {
      const direct = splitPeople(text);
      if (direct.length > 1) {
        return direct;
      }
    }

    const tokens = text.split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];

    const seen = new Set();
    const results = [];
    let matchedKnown = false;
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      const lower = token.toLowerCase();
      if (/^(and|&)$/.test(lower)) {
        index += 1;
        continue;
      }

      let matched = null;
      for (const entry of rosterEntries) {
        const { parts } = entry;
        if (parts.length === 0) continue;
        if (index + parts.length > tokens.length) continue;
        let ok = true;
        for (let offset = 0; offset < parts.length; offset += 1) {
          if (tokens[index + offset].toLowerCase() !== parts[offset]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          matched = entry;
          break;
        }
      }

      if (matched) {
        if (!seen.has(matched.name)) {
          results.push(matched.name);
          seen.add(matched.name);
        }
        matchedKnown = true;
        index += matched.parts.length;
        continue;
      }

      const candidate = capitalizeWord(token);
      if (!seen.has(candidate)) {
        results.push(candidate);
        seen.add(candidate);
      }
      index += 1;
    }

    if (!matchedKnown && results.length > 1) {
      return [text];
    }

    return results;
  };

  const filterEvents = (events, typeFilter, nameQuery, personFilter, roster = rosterData) => {
    const q = (nameQuery || "").trim().toLowerCase();
    const pf = normalizeName(personFilter || "");
    return events.filter((ev) => {
      const passType = !typeFilter || (ev.extendedProps.dutyType || "").includes(typeFilter);
      const blob = [ev.title, ev.extendedProps.assignedTo, ev.extendedProps.dutyType].join(" ").toLowerCase();
      const passName = !q || blob.includes(q);
      const personList = ev.extendedProps.personList || [];
      const normalizedPeople = personList.map(normalizeName);
      const passPerson = !pf || normalizedPeople.includes(pf) || normalizedPeople.some(name => name.includes(pf));
      return passType && passName && passPerson;
    });
  };

  // ---- ICS Export helpers ----
  const formatICSDate = (date) => {
    // Returns UTC timestamp in YYYYMMDDTHHMMSSZ
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  };

  const icsEscape = (s) => {
    return String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  };

  const buildIcs = (events) => {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//RA Duty//Calendar Export//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    const now = new Date();
    const dtstamp = formatICSDate(now);

    events.forEach((ev) => {
      const uid = `${ev.start.getTime()}-${Math.random().toString(36).slice(2)}@ra-duty`;
      const summary = icsEscape(ev.title);
      const descParts = [];
      if (ev.extendedProps?.dutyType) descParts.push(`Type: ${ev.extendedProps.dutyType}`);
      if (ev.extendedProps?.assignedTo) descParts.push(`Assigned: ${ev.extendedProps.assignedTo}`);
      if (ev.extendedProps?.complete) descParts.push(`Complete: ${ev.extendedProps.complete}`);
      const description = icsEscape(descParts.join("\n"));

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${formatICSDate(ev.start)}`,
        `DTEND:${formatICSDate(ev.end)}`,
        `SUMMARY:${summary}`,
        description ? `DESCRIPTION:${description}` : undefined,
        "END:VEVENT"
      );
    });

    lines.push("END:VCALENDAR");
    return lines.filter(Boolean).join("\r\n");
  };

  const downloadIcs = (filename, content) => {
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    
    // For mobile browsers, try different approaches
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
      // Use Web Share API on mobile if available
      const file = new File([blob], filename, { type: "text/calendar" });
      navigator.share({
        files: [file],
        title: "Calendar Export"
      }).catch(() => {
        // Fallback to download link if sharing fails
        fallbackDownload(blob, filename);
      });
    } else {
      // Standard download for desktop and fallback
      fallbackDownload(blob, filename);
    }
  };
  
  const fallbackDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  };

  const bootstrap = async () => {
    const rows = await loadCSV();
    const roster = buildRoster(rows);
    rosterData = roster;
    const eventsRaw = rows
      .filter(r => r.Title && r.Start && r.End)
      .map((r) => {
        const start = parseDate(r.Start.trim());
        const end = parseDate(r.End.trim());
        const dutyType = (r["Duty Type"] || "").replace(/\[|\]|"/g, "").trim();
        const assignedTo = (r["Assigned To"] || "").trim();
        const assignedPeople = splitPeople(assignedTo);
        const fallbackPeople = extractPeopleFromTitle(r.Title, roster);
        const rawPeople = assignedPeople.length ? assignedPeople : fallbackPeople;
        const normalizedPeople = rawPeople
          .flatMap((name) => resolveNameSegments(name, roster))
          .map((name) => canonicalizeName(name, roster))
          .map((name) => name.replace(/\s+/g, " ").trim())
          .filter(Boolean);
        const uniquePeople = [];
        const seenPeople = new Set();
        normalizedPeople.forEach((personName) => {
          const key = normalizeName(personName);
          if (key && !seenPeople.has(key)) {
            seenPeople.add(key);
            uniquePeople.push(personName);
          }
        });
        const complete = (r["Duty Complete"] || "").trim();
        return {
          title: r.Title,
          start,
          end,
          backgroundColor: typeColor(dutyType),
          borderColor: typeColor(dutyType),
          extendedProps: { dutyType, assignedTo, complete, personList: uniquePeople },
        };
      });

    const calendarEl = document.getElementById("calendar");
    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "dayGridMonth",
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,listWeek",
      },
      height: "auto",
      events: eventsRaw,
      displayEventTime: false,
      eventContent: (arg) => {
        // Render title only, allowing wrap so full names show
        const titleEl = document.createElement('div');
        titleEl.className = 'fc-event-title';
        titleEl.style.whiteSpace = 'normal';
        titleEl.textContent = arg.event.title;
        return { domNodes: [titleEl] };
      },
      eventDidMount: (info) => {
        const { dutyType, assignedTo, complete } = info.event.extendedProps;
        const tooltip = `${info.event.title}\n${dutyType ? `Type: ${dutyType}\n` : ""}${assignedTo ? `Assigned: ${assignedTo}\n` : ""}${complete ? `Complete: ${complete}` : ""}`;
        info.el.title = tooltip;
      },
    });

    calendar.render();

    // Custom person selector for mobile compatibility
    const personInputEl = document.getElementById("personInput");
    const personDropdownEl = document.getElementById("personDropdown");
    const peopleListEl = document.getElementById("peopleList");
    
    // Populate person list from CSV
    const peopleMap = new Map();
    eventsRaw
      .flatMap(e => (e.extendedProps.personList || []))
      .flatMap((name) => resolveNameSegments(name, roster))
      .map((name) => canonicalizeName(name, roster))
      .map((name) => name.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .forEach((name) => {
        const key = normalizeName(name);
        if (key && !peopleMap.has(key)) {
          peopleMap.set(key, name);
        }
      });
    const people = Array.from(peopleMap.values()).sort((a, b) => a.localeCompare(b));
    
    // Add "All" option at the beginning
    const allPeople = ['All', ...people];
    
    // Populate traditional datalist (for desktop browsers that support it)
    if (peopleListEl) {
      peopleListEl.innerHTML = '';
      allPeople.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name === 'All' ? '' : name;
        peopleListEl.appendChild(opt);
      });
    }
    
    // Initialize input value
    if (personInputEl) {
      const saved = localStorage.getItem('selectedPerson') || '';
      personInputEl.value = saved || 'All';
    }
    
    // Custom dropdown functionality
    const populateDropdown = (filter = '') => {
      if (!personDropdownEl) return;
      
      const filteredPeople = allPeople.filter(name => 
        name.toLowerCase().includes(filter.toLowerCase())
      );
      
      personDropdownEl.innerHTML = '';
      filteredPeople.forEach(name => {
        const option = document.createElement('div');
        option.className = 'person-option';
        option.textContent = name;
        option.dataset.value = name === 'All' ? '' : name;
        
        option.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          personInputEl.value = name;
          const value = name === 'All' ? '' : name;
          localStorage.setItem('selectedPerson', value);
          hideDropdown();
          applyFilters();
          personInputEl.blur(); // Remove focus to prevent reopening
        });
        
        personDropdownEl.appendChild(option);
      });
    };
    
    const showDropdown = () => {
      if (personDropdownEl) {
        personDropdownEl.classList.remove('hidden');
      }
    };
    
    const hideDropdown = () => {
      if (personDropdownEl) {
        personDropdownEl.classList.add('hidden');
      }
    };

    const applyFilters = () => {
      const value = personInputEl ? (personInputEl.value === 'All' ? '' : personInputEl.value) : '';
      const filtered = filterEvents(
        eventsRaw,
        '',
        '',
        value,
        roster
      );
      calendar.removeAllEvents();
      calendar.addEventSource(filtered);
    };

    // Event listeners for custom dropdown
    if (personInputEl && personDropdownEl) {
      // Show dropdown on focus
      personInputEl.addEventListener('focus', () => {
        setTimeout(() => {
          populateDropdown(personInputEl.value === 'All' ? '' : personInputEl.value);
          showDropdown();
        }, 100);
      });
      
      // Filter dropdown on input
      personInputEl.addEventListener('input', (e) => {
        const value = e.target.value;
        populateDropdown(value === 'All' ? '' : value);
        showDropdown();
        
        // Don't auto-filter while typing, wait for selection
      });
      
      // Handle manual typing and enter key
      personInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const value = personInputEl.value === 'All' ? '' : personInputEl.value;
          localStorage.setItem('selectedPerson', value);
          hideDropdown();
          applyFilters();
        } else if (e.key === 'Escape') {
          hideDropdown();
        }
      });
      
      // Hide dropdown when clicking outside
      document.addEventListener('click', (e) => {
        const personSelector = personInputEl.closest('.person-selector');
        if (personSelector && !personSelector.contains(e.target)) {
          hideDropdown();
        }
      });
      
      // Initialize dropdown
      populateDropdown();
    }
    // No custom view selector

    // Export to Calendar (ICS) via modal prompt
    const exportBtn = document.getElementById("exportIcs");
    const exportModal = document.getElementById("exportModal");
    const exportPersonInput = document.getElementById("exportPersonInput");
    const exportCancel = document.getElementById("exportCancel");
    const exportConfirm = document.getElementById("exportConfirm");

    // Setup export modal dropdown
    const exportPersonDropdownEl = document.getElementById("exportPersonDropdown");
    
    const populateExportDropdown = (filter = '') => {
      if (!exportPersonDropdownEl) return;
      
      const filteredPeople = allPeople.filter(name => 
        name.toLowerCase().includes(filter.toLowerCase())
      );
      
      exportPersonDropdownEl.innerHTML = '';
      filteredPeople.forEach(name => {
        const option = document.createElement('div');
        option.className = 'person-option';
        option.textContent = name;
        option.dataset.value = name === 'All' ? '' : name;
        
        option.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          exportPersonInput.value = name;
          exportPersonDropdownEl.classList.add('hidden');
          exportPersonInput.blur(); // Remove focus to prevent reopening
        });
        
        exportPersonDropdownEl.appendChild(option);
      });
    };
    
    // Export modal dropdown event listeners
    if (exportPersonInput && exportPersonDropdownEl) {
      exportPersonInput.addEventListener('focus', () => {
        setTimeout(() => {
          populateExportDropdown(exportPersonInput.value === 'All' ? '' : exportPersonInput.value);
          exportPersonDropdownEl.classList.remove('hidden');
        }, 100);
      });
      
      exportPersonInput.addEventListener('input', (e) => {
        const value = e.target.value;
        populateExportDropdown(value === 'All' ? '' : value);
        exportPersonDropdownEl.classList.remove('hidden');
      });
      
      exportPersonInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          exportPersonDropdownEl.classList.add('hidden');
        }
      });
      
      // Hide export dropdown when clicking outside
      document.addEventListener('click', (e) => {
        const exportSelector = exportPersonInput.closest('.person-selector');
        if (exportSelector && !exportSelector.contains(e.target)) {
          exportPersonDropdownEl.classList.add('hidden');
        }
      });
    }

    const openExportModal = () => {
      if (!exportModal) return;
      // Prefill with current person filter if any
      if (exportPersonInput && personInputEl) {
        exportPersonInput.value = personInputEl.value || 'All';
      }
      exportModal.classList.remove('hidden');
      exportModal.setAttribute('aria-hidden', 'false');
      const onKey = (e) => { if (e.key === 'Escape') { closeExportModal(); } };
      exportModal._escHandler = onKey;
      document.addEventListener('keydown', onKey);
    };
    const closeExportModal = () => {
      if (!exportModal) return;
      exportModal.classList.add('hidden');
      exportModal.setAttribute('aria-hidden', 'true');
      if (exportModal._escHandler) {
        document.removeEventListener('keydown', exportModal._escHandler);
        delete exportModal._escHandler;
      }
    };

    if (exportBtn) {
      exportBtn.addEventListener("click", openExportModal);
    }
    if (exportCancel) {
      exportCancel.addEventListener("click", closeExportModal);
    }
    if (exportModal) {
      // Close when clicking on backdrop or outside content
      exportModal.addEventListener('click', (e) => {
        const backdrop = exportModal.querySelector('.modal-backdrop');
        if (e.target === exportModal || e.target === backdrop || e.target.classList.contains('modal-backdrop')) {
          closeExportModal();
        }
      });
    }
    if (exportConfirm) {
      exportConfirm.addEventListener('click', () => {
        const rawValue = exportPersonInput ? exportPersonInput.value : '';
        const selectedForExport = rawValue === 'All' ? '' : rawValue;
        const filtered = filterEvents(
          eventsRaw,
          '',
          '',
          selectedForExport,
          roster
        );
        const ics = buildIcs(filtered);
        const suffix = [];
        if (selectedForExport) suffix.push(selectedForExport.trim().replace(/\s+/g, "-"));
        const filename = `duty-calendar${suffix.length ? "-" + suffix.join("-") : ""}.ics`;
        downloadIcs(filename, ics);
        closeExportModal();
      });
    }
  };

  window.addEventListener("DOMContentLoaded", bootstrap);
})();
