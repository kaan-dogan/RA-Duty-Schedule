(() => {
  const csvPath = "./Thistle - Pollock Duty Calendar.csv";

  const typeColor = (type) => {
    if (!type) return "#6b7280";
    if (type.includes("PG Only Duty")) return "#10b981";
    return "#3b82f6"; // RA default
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

  const filterEvents = (events, typeFilter, nameQuery) => {
    const q = (nameQuery || "").trim().toLowerCase();
    return events.filter((ev) => {
      const passType = !typeFilter || (ev.extendedProps.dutyType || "").includes(typeFilter);
      const blob = [ev.title, ev.extendedProps.assignedTo, ev.extendedProps.dutyType].join(" ").toLowerCase();
      const passName = !q || blob.includes(q);
      return passType && passName;
    });
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
    const viewSelectEl = document.getElementById("viewSelect");

    const applyFilters = () => {
      const filtered = filterEvents(eventsRaw, typeFilterEl.value, nameSearchEl.value);
      calendar.removeAllEvents();
      calendar.addEventSource(filtered);
    };

    typeFilterEl.addEventListener("change", applyFilters);
    nameSearchEl.addEventListener("input", applyFilters);
    viewSelectEl.addEventListener("change", () => calendar.changeView(viewSelectEl.value));
  };

  window.addEventListener("DOMContentLoaded", bootstrap);
})();
