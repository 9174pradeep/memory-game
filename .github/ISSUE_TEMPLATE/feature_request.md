name: Feature request
description: Suggest an idea or improvement for the game
title: "[Feature]: "
labels: [enhancement]
body:
  - type: markdown
    attributes:
      value: |
        Ideas are welcome! Please describe what you have in mind.

  - type: textarea
    id: problem
    attributes:
      label: What problem would this solve?
      description: Why do you want this feature? What is the user story?
    validations:
      required: true

  - type: textarea
    id: proposal
    attributes:
      label: Describe the solution you would like
      description: How should it work from the player's point of view?
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives you considered

  - type: dropdown
    id: area
    attributes:
      label: Which area does this touch?
      options:
        - Gameplay
        - Frontend / UI
        - Backend / API
        - Score formula
        - Accessibility
        - Documentation
        - Something else
    validations:
      required: true

  - type: checkboxes
    id: checks
    attributes:
      label: Checklist
      options:
        - label: I searched the existing issues and this is not a duplicate.
          required: true
