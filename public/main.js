(() => {
  const csvPath = "./Thistle - Pollock Duty Calendar.csv";
  
  // Theme management
  const initTheme = () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  };
  
  const updateThemeIcon = (theme) => {
    const themeIcon = document.querySelector('.theme-icon');
    if (themeIcon) {
      themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  };
  
  const toggleTheme = () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
  };

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

  const loadCSV = () => new Promise((resolve, reject) => {
    Papa.parse(csvPath, {
      download: true,
      header: true,
      complete: (res) => resolve(res.data || []),
      error: reject,
      skipEmptyLines: true,
    });
  });

  const filterEvents = (events, typeFilter, nameQuery, personFilter) => {
    const q = (nameQuery || "").trim().toLowerCase();
    const pf = (personFilter || "").trim().toLowerCase();
    return events.filter((ev) => {
      const passType = !typeFilter || (ev.extendedProps.dutyType || "").includes(typeFilter);
      const blob = [ev.title, ev.extendedProps.assignedTo, ev.extendedProps.dutyType].join(" ").toLowerCase();
      const passName = !q || blob.includes(q);
      const passPerson = !pf || (ev.extendedProps.assignedTo || "").toLowerCase().includes(pf);
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  };

  const bootstrap = async () => {
    const rows = await loadCSV();
    const eventsRaw = rows
      .filter(r => r.Title && r.Start && r.End)
      .map((r) => {
        const start = parseDate(r.Start.trim());
        const end = parseDate(r.End.trim());
        const dutyType = (r["Duty Type"] || "").replace(/\[|\]|"/g, "").trim();
        const assignedTo = (r["Assigned To"] || "").trim();
        const complete = (r["Duty Complete"] || "").trim();
        return {
          title: r.Title,
          start,
          end,
          backgroundColor: typeColor(dutyType),
          borderColor: typeColor(dutyType),
          extendedProps: { dutyType, assignedTo, complete },
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

    const typeFilterEl = document.getElementById("typeFilter");
    const nameSearchEl = document.getElementById("nameSearch");
    const personSelectEl = document.getElementById("personSelect");
    
    // Populate person list from CSV
    const people = Array.from(new Set(
      eventsRaw
        .map(e => (e.extendedProps.assignedTo || "").trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
    if (personSelectEl) {
      const saved = localStorage.getItem('selectedPerson') || '';
      people.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        personSelectEl.appendChild(opt);
      });
      // Restore previous selection if present
      personSelectEl.value = saved;
    }
    const viewSelectEl = document.getElementById("viewSelect");

    const applyFilters = () => {
      const filtered = filterEvents(
        eventsRaw,
        typeFilterEl.value,
        nameSearchEl.value,
        personSelectEl ? personSelectEl.value : ''
      );
      calendar.removeAllEvents();
      calendar.addEventSource(filtered);
    };

    typeFilterEl.addEventListener("change", applyFilters);
    nameSearchEl.addEventListener("input", applyFilters);
    if (personSelectEl) {
      personSelectEl.addEventListener("change", () => {
        localStorage.setItem('selectedPerson', personSelectEl.value);
        applyFilters();
      });
    }
    viewSelectEl.addEventListener("change", () => calendar.changeView(viewSelectEl.value));
    
    // Setup theme toggle
    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle) {
      themeToggle.addEventListener("click", toggleTheme);
    }
    
    // Initialize theme
    initTheme();

    // Export to Calendar (ICS) via modal prompt
    const exportBtn = document.getElementById("exportIcs");
    const exportModal = document.getElementById("exportModal");
    const exportPersonSelect = document.getElementById("exportPersonSelect");
    const exportCancel = document.getElementById("exportCancel");
    const exportConfirm = document.getElementById("exportConfirm");

    const openExportModal = () => {
      if (!exportModal) return;
      // Populate options if empty or needs refresh
      if (exportPersonSelect && exportPersonSelect.childElementCount <= 1) {
        people.forEach(name => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          exportPersonSelect.appendChild(opt);
        });
      }
      // Prefill with current person filter if any
      if (exportPersonSelect && personSelectEl) {
        exportPersonSelect.value = personSelectEl.value || '';
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
        const selectedForExport = exportPersonSelect ? exportPersonSelect.value : '';
        const filtered = filterEvents(
          eventsRaw,
          typeFilterEl.value,
          nameSearchEl.value,
          selectedForExport
        );
        const ics = buildIcs(filtered);
        const suffix = [];
        if (typeFilterEl.value) suffix.push(typeFilterEl.value.replace(/\s+/g, "-"));
        if (selectedForExport) suffix.push(selectedForExport.trim().replace(/\s+/g, "-"));
        else if (nameSearchEl.value) suffix.push(nameSearchEl.value.trim().replace(/\s+/g, "-"));
        const filename = `duty-calendar${suffix.length ? "-" + suffix.join("-") : ""}.ics`;
        downloadIcs(filename, ics);
        closeExportModal();
      });
    }
  };

  window.addEventListener("DOMContentLoaded", bootstrap);
})();
