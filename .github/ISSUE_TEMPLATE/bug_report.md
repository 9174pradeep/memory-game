name: Bug report
description: Something in the game does not work as expected
title: "[Bug]: "
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report a bug! 🐛
        Please fill in as much of the template below as you can.

  - type: textarea
    id: description
    attributes:
      label: What happened?
      description: A clear and concise description of the bug.
    validations:
      required: true

  - type: textarea
    id: reproduction
    attributes:
      label: Steps to reproduce
      description: How can a developer reproduce the problem?
      placeholder: |
        1. Start a game on Hard
        2. Flip the first two cards
        3. ...
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: What did you expect to happen?
    validations:
      required: true

  - type: input
    id: difficulty
    attributes:
      label: Difficulty
      placeholder: Easy / Medium / Hard

  - type: input
    id: node-version
    attributes:
      label: Node version
      placeholder: v20.11.1
    validations:
      required: true

  - type: input
    id: browser
    attributes:
      label: Browser and version
      placeholder: Chrome 131
      description: Only needed for frontend issues.

  - type: textarea
    id: console
    attributes:
      label: Console output
      description: Any errors or warnings from the browser or the server.
      render: shell

  - type: checkboxes
    id: checks
    attributes:
      label: Checklist
      options:
        - label: I searched the existing issues and this is not a duplicate.
          required: true
        - label: I checked that the server is running (`curl http://localhost:3000/api/health`).
