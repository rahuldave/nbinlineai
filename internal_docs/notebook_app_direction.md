# Deferred direction: notebook widgets and inline apps

**Discussion notes, 2026-09-28. Not an implementation specification.**
The user selected browser/media and notebook-view tools first. Developing an
app specification and implementing it are separate later work; neither is a
prerequisite for the [media spec](browser_media_tool_spec.md) or its
[implementation task](browser_media_tool_task_prompt.md). No app implementation
prompt is supplied yet. All internal documentation remains canonical on main.

## Direction to revisit

An app could be an existing interactive notebook widget exposed to an agent,
or a small inline JavaScript component. Avoid requiring users to rewrite
widgets as a new app framework. Start by evaluating one shared Jupyter Widgets
adapter: anywidget participates in that ecosystem rather than being a separate
competing transport. A managed inline JavaScript surface is a second option.
A bare `IPython.display.HTML` div does not provide identity, state, lifecycle
or an agent message protocol on its own.

The useful common surface is declared state, actions, events and native export.
Ordinary synced traits can support generic inspection; meaningful operations
such as selecting a region or changing an array slice need explicit semantics.
Do not infer arbitrary callable actions from every Python attribute or expose
an entire dataset in model context. Keep model identity distinct from each
rendered view: one widget can appear twice, and closing a view must not destroy
a shared model.

Browser-visible state can change before Python processes a widget message.
Normal widget comms do not make a busy kernel run callbacks concurrently. A
later spec must distinguish browser acknowledgement, pending kernel work and
confirmed Python effects. Existing widgets retain their normal trust model;
any isolation for a new inline JavaScript surface is a separate design.
Identified-cell execution and event-triggered AI continuation remain experimental
compositions, not requirements for ordinary widget interaction.

## Candidate libraries, not promised integrations

| Target | Why consider it | Possible adapter surface |
| --- | --- | --- |
| [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/examples/Widget%20Low%20Level.html) and [anywidget](https://anywidget.dev/en/getting-started/) | Shared widget models, views and comms; anywidget supplies a compact JavaScript rendering API | Selected synced state, declared actions, change events and view identity |
| [wigglystuff](https://github.com/koaning/wigglystuff) | Concrete anywidget collection; [Slider2D](https://koaning.github.io/wigglystuff/reference/slider2d/) and [ColorPicker](https://koaning.github.io/wigglystuff/reference/color-picker/) are small initial compatibility candidates | Position (`x`, `y`) or selected `color`; test external updates and event behavior before claiming support |
| [hvPlot for xarray](https://hvplot.holoviz.org/en/docs/latest/user_guide/Gridded_Data.html) | Multidimensional labelled-array visualization; its UI stack is distinct from Jupyter Widgets | Dimension/slice selection, ranges, bounded summaries; retain bulk arrays in the kernel/data backend |
| [ipyleaflet](https://ipyleaflet.readthedocs.io/en/master/) and [xarray-leaflet](https://xarray-leaflet.readthedocs.io/en/latest/usage.html) | Widget maps and tiled array views | Viewport, layers and selected regions; assess tile/data-serving requirements separately |
| [fastplotlib](https://github.com/fastplotlib/fastplotlib) | High-performance scientific graphics with its own rendering/backend requirements | Camera/view, data slice, selection and supported export; evaluate backend and browser limits explicitly |

These are research candidates, not installed dependencies or verified
cross-browser/mobile integrations. Specialist adapters should be optional
library integrations. Here “extensions” means adapters or packages within the
notebook ecosystem, **not browser extensions**. Do not auto-install libraries
or make them core requirements. No compatibility run or source copying was
performed for these notes.

The media tools can export an existing SVG or capture a supported output canvas
without any app adapter. Native app scene/vector export belongs to this later
workstream and requires an actual exporter; pixels do not recover vectors.
Reuse media/PIL/`save_to` conventions if and when that integration is designed.
