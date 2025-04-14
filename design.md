**Title**: Interaction Net Sandbox Web App Design

---

## Overview

A physics-based sandbox web application for exploring interaction combinators and interaction nets. The interface allows users to build a library of atomic combinators, axioms, definitions, and theorems, with an intuitive physics-based editor and rewrite engine.

---

## Interface Layout

### Title Bar

- A text box at the top labeled "Untitled" by default.
- Double-clicking allows renaming the workspace.

---

## Atomic Node Design

### Parameters

- **Principal Ports**: User specifies quantity (support for multi-principal ports).
- **Non-Principal Ports**: User specifies quantity.
- **Labeling**: Ports labeled counterclockwise starting from first principal port.
- **Color**: User-selected fill color.
- **Name**: Displayed inside node.
- **Metadata**:
  - Add/remove named fields (e.g., "label", "size").
  - Values editable per-instance in canvas (string, number, etc.).

### Submission

- After parameters are filled, clicking "Submit" adds the node to the library.

---

## Canvas and Physics

### Node Behavior

- Drag-and-drop from library into main canvas.
- Nodes can be flicked with mouse and have basic momentum + friction.
- Nodes repel on overlap (like billiard balls).

### Port Representation

- Lines protrude from ports.
- Principal ports marked with black dots.

### Wiring

- Click-drag from one port to another to connect.
- Wires are strings (not springs):
  - Constant-length unless changed manually (mouse wheel up to lengthen the links, mouse wheel down to shorten the links).
  - Simulated via linkage/chain/rope-based physics.
  - Bezier curve rendered using linkages as guide.
  - Wires can be clicked-and-dragged from any point by the mouse, with physics simulating appropriate forces from the drag point.

### Metadata Editing

- Double-click a node to reveal metadata popup:
  - Editable fields with null defaults.
  - Checkboxes to toggle visibility.

---

## Axiom Interface

### Setup

- Select two atomic nodes connected by one principal port.
- Click "Add Axiom" to validate and enter axiom editor.

### Rule Definition

- One or more result options per axiom.
- Each result has:
  - **Guard**: JS boolean expression (can reference metadata).
  - **Diagram**: Replacement diagram preserving outgoing ports.

### Port Specification

- When defining an axiom, a dashed circular border appears around the canvas. User is instructed to define starting configuration of rewrite by connecting all ports.
- All dangling ports must be connected to this dashed circle.
- The port types (principal vs non-principal) are inferred from the connections.
- Same dashed circle, with all its ports, generated for starting configuration is used for all rewrite options.
- Ports from the dashed circle can be connected to one another.

### Submission

- Each rewrite option must have no dangling ports (including dashed circle ports)
- Label required for each option within axiom.
- Added to axiom library.

### Application

- Double-click wire between two atomic nodes with connected principal ports.
- If matching axiom:
  - Evaluate guards.
  - If one match: auto-apply.
  - If multiple: dropdown to choose rule.

---

## Definition Nodes

### Creation

- User clicks "Add Definition" to enter definition mode.
- Zoom is disabled.
- A dashed circle appears at the border of the canvas.
- Dangling ports can connect to this dashed circle.
- Port type is inferred from the connection: principal ports remain principal, others are non-principal.
- Additional ports can be created by clicking the dashed circle (ONLY FOR DEFINITIONS!).
- Ports can connect to one another, including the possibility of dashed circle self-connection.
- Definition is validated by ensuring no dangling ports remain.
- User assigns name and color.

### Usage

- Behaves like atomic node in canvas.
- Double-click to expand inline.
- Cannot have metadata.

---

## Theorem Interface

### Creation

- Source: two nodes connected by principal port (at least one must be a definition).

- Target: any diagram with same number of outgoing ports.

- When defining a theorem, a dashed circular border appears around the canvas, and the user is instructed to construct the source.

- All dangling ports must be connected to this dashed circle.

- The port types (principal vs non-principal) are inferred from the connections.

- Ports from the dashed circle \*cannot\* be connected to one another, only dangling ports.

- Same dashed circle, with all its ports, generated for source is used for the target.

### Proof Interface

- Side-by-side canvas for source and target.
- No node addition allowed.
- Allowed operations:
  - Apply axioms
  - Apply theorems
  - Expand definitions
- Goal: make both canvases identical.

### Submission

- Click "Theorem Proved" if canvases match (by structure, name, metadata).
- Added to theorem library.

### Application

- Double-click wire between nodes (at least one must be a definition).
- If matching theorem:
  - One match: auto-apply.
  - Multiple: dropdown to choose.

---

## Utilities and Features

### File Handling

- **Export Library**: JSON including all atomic nodes, axioms, definitions, theorems, and title.
- **Import Library**: Load from JSON.
- **Export Canvas**: Export current diagram as SVG.

### Navigation

- Zoom in/out buttons near import/export (disabled during definition/axiom/theorem mode).

---

## Summary

This design specifies a sandbox web application for interaction nets, combining a physics-based visual interface with formal rewrite logic. It supports a modular approach to constructing and interacting with atomic nodes, axioms, definitions, and theorems in a visually intuitive and semantically correct environment. A consistent dashed-circle interface is used throughout for defining the port structure of axioms, definitions, and theorems.

---

Coding style guidelines

Every file should be relatively small, less than 500 lines. Anything longer should be split up into multiple files.

Focus on function abstractions. Function definitions should not be more than a few dosen lines. Any longer, and the function should be split up into multiple defniitions with clearly articulated intents in funciton names.

Every file should have a clear, intuitive names. Files should NEVER have vague names like "store" or "utils".

Before makeing any edits, make sure to look at the directory rather than proceeding based on an assumption.

NEVER LEAVE HISTORICAL COMMENTS IN CODE! Never write something like "Removed" or "Unchanged" in a code comment. Just make a change, don't mention in the code itself that a change was made.