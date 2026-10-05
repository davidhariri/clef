export const testUiSpec = {
  root: 'card',
  elements: {
    card: {
      type: 'Card',
      props: {
        title: 'Model preferences',
      },
      children: [
        'intro',
        'comparison',
        'fields',
        'buttons',
      ],
    },
    intro: {
      type: 'Text',
      props: {
        text: 'Choose what you want to discuss.',
      },
    },
    comparison: {
      type: 'Table',
      props: {
        columns: [
          'Model',
          'Purpose',
        ],
        rows: [
          [
            'Imaginary model',
            'Discussion only',
          ],
        ],
      },
    },
    fields: {
      type: 'Stack',
      props: {
        direction: 'vertical',
      },
      children: [
        'model',
        'topic',
        'notes',
        'detail',
      ],
    },
    model: {
      type: 'Select',
      props: {
        label: 'Model',
        value: {
          $bindState: '/model',
        },
        options: [
          {
            label: 'Imaginary model',
            value: 'imaginary',
          },
          {
            label: 'Another model',
            value: 'another',
          },
        ],
      },
    },
    topic: {
      type: 'Input',
      props: {
        label: 'Topic',
        value: {
          $bindState: '/topic',
        },
      },
    },
    notes: {
      type: 'Textarea',
      props: {
        label: 'Notes',
        value: {
          $bindState: '/notes',
        },
      },
    },
    detail: {
      type: 'Checkbox',
      props: {
        label: 'Include details',
        checked: {
          $bindState: '/detail',
        },
      },
    },
    buttons: {
      type: 'Stack',
      props: {
        direction: 'horizontal',
      },
      children: [
        'submit',
        'cancel',
      ],
    },
    submit: {
      type: 'Button',
      props: {
        label: 'Discuss choices',
      },
      on: {
        press: {
          action: 'submit',
          params: {
            intent: 'discuss',
          },
        },
      },
    },
    cancel: {
      type: 'Button',
      props: {
        label: 'Skip',
      },
      on: {
        press: {
          action: 'submit',
          params: {
            intent: 'skip',
          },
        },
      },
    },
  },
  state: {
    model: 'imaginary',
    topic: '',
    notes: '',
    detail: false,
  },
};
