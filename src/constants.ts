export const DEFAULT_NUMBERING = {
  config: [
    {
      reference: "NumberedList",
      levels: [
        {
          level: 0,
          format: "decimal",
          text: "%1.",
          alignment: "left",
          style: {
            paragraph: {
              indent: { left: 720, hanging: 360 },
            },
          },
        },
      ],
    },
    {
      reference: "BulletList",
      levels: [
        {
          level: 0,
          format: "bullet",
          text: "•",
          alignment: "left",
          style: {
            paragraph: {
              indent: { left: 720, hanging: 360 },
            },
          },
        },
      ],
    },
  ],
};
