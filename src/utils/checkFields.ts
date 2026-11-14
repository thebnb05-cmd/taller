export interface CheckFieldOption {
  key: string;
  label: string;
  options: string[];
}

export const PHYSICAL_DEFAULT_FIELDS: CheckFieldOption[] = [
  { key: 'Pantalla', label: 'Pantalla', options: ['OK', 'Rayada', 'Rota'] },
  { key: 'Tapa trasera', label: 'Tapa trasera', options: ['OK', 'Despegada', 'Rayada', 'Rota'] },
  { key: 'Marco / Bisel', label: 'Marco / Bisel', options: ['OK', 'Doblado', 'Dañado'] },
  { key: 'Corrosión / Óxido', label: 'Corrosión / Óxido', options: ['No', 'Leve', 'Severa'] },
  { key: 'Puerto de carga', label: 'Puerto de carga', options: ['OK', 'Sucio', 'Dañado'] },
  { key: 'Reparación anterior', label: 'Reparación anterior', options: ['No', 'Sí'] },
  { key: 'Estado general', label: 'Estado general', options: ['OK', 'Regular', 'Malo'] },
  { key: 'Rayones', label: 'Rayones', options: ['No', 'Leves', 'Severos'] },
  { key: 'Golpes visibles', label: 'Golpes visibles', options: ['No', 'Leves', 'Severos'] },
];

export const PHYSICAL_SIMPLE_FIELDS: CheckFieldOption[] = [
  { key: 'Estado general', label: 'Estado general', options: ['OK', 'Regular', 'Malo'] },
  { key: 'Rayones', label: 'Rayones', options: ['No', 'Leves', 'Severos'] },
  { key: 'Golpes visibles', label: 'Golpes visibles', options: ['No', 'Leves', 'Severos'] },
];

export const PHYSICAL_PC_FIELDS: CheckFieldOption[] = [
  { key: 'Gabinete / Chasis', label: 'Gabinete / Chasis', options: ['OK', 'Rayado', 'Abollado', 'Sin tapa'] },
  { key: 'Tapa lateral / Vidrio', label: 'Tapa lateral / Vidrio', options: ['OK', 'Rayado', 'Roto', 'Faltante'] },
  { key: 'Polvo / Suciedad', label: 'Polvo / Suciedad', options: ['Limpio', 'Moderado', 'Excesivo'] },
  { key: 'Cables internos', label: 'Cables internos', options: ['OK', 'Sueltos', 'Dañados'] },
  { key: 'Humedad / Óxido', label: 'Humedad / Óxido', options: ['No', 'Leve', 'Severa'] },
  { key: 'Reparación anterior', label: 'Reparación anterior', options: ['No', 'Sí'] },
  { key: 'Golpes visibles', label: 'Golpes visibles', options: ['No', 'Leves', 'Severos'] },
];

export const FUNCTIONAL_DEFAULT_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende', label: 'Enciende', options: ['OK', 'No', 'No probado'] },
  { key: 'Touch / Táctil', label: 'Touch / Táctil', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Carga', label: 'Carga', options: ['OK', 'No', 'No probado'] },
  { key: 'Sonido', label: 'Sonido', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Micrófono', label: 'Micrófono', options: ['OK', 'Falla', 'No probado'] },
  { key: 'WiFi', label: 'WiFi', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Botones', label: 'Botones', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Huella / FaceID', label: 'Huella / FaceID', options: ['OK', 'Falla', 'No tiene'] },
];

export const FUNCTIONAL_NOTEBOOK_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende', label: 'Enciende', options: ['OK', 'No', 'No probado'] },
  { key: 'Lector de discos', label: 'Lector de discos', options: ['OK', 'Falla', 'No tiene'] },
  { key: 'Imagen HDMI', label: 'Imagen HDMI', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Ventilador', label: 'Ventilador', options: ['OK', 'Falla', 'No probado'] },
];

export const FUNCTIONAL_PC_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende / Arranca', label: 'Enciende / Arranca', options: ['OK', 'No enciende', 'Se reinicia'] },
  { key: 'Da video / Imagen', label: 'Da video / Imagen', options: ['OK', 'Sin señal', 'Artefactos'] },
  { key: 'Fuente de poder', label: 'Fuente de poder', options: ['OK', 'Falla', 'No probada'] },
  { key: 'Coolers / Ventilación', label: 'Coolers / Ventilación', options: ['OK', 'Ruidosos', 'No giran'] },
  { key: 'Disco (SSD / HDD)', label: 'Disco (SSD / HDD)', options: ['OK', 'Lento / Falla', 'No detecta'] },
  { key: 'Memoria RAM', label: 'Memoria RAM', options: ['OK', 'Falla', 'No probada'] },
  { key: 'Puertos USB / Audio', label: 'Puertos USB / Audio', options: ['OK', 'Falla parcial', 'No funcionan'] },
  { key: 'Red (LAN / WiFi)', label: 'Red (LAN / WiFi)', options: ['OK', 'Falla', 'No tiene'] },
  { key: 'Sistema operativo', label: 'Sistema operativo', options: ['OK', 'No inicia', 'Lento / Virus'] },
];

export const FUNCTIONAL_CONSOLE_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende', label: 'Enciende', options: ['OK', 'No', 'No probado'] },
  { key: 'Lector de discos', label: 'Lector de discos', options: ['OK', 'Falla', 'No tiene'] },
  { key: 'Imagen HDMI', label: 'Imagen HDMI', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Ventilador', label: 'Ventilador', options: ['OK', 'Ruidoso', 'No funciona'] },
];

export function getPhysicalCheckFields(deviceType?: string): CheckFieldOption[] {
  if (deviceType === 'PC de escritorio') {
    return PHYSICAL_PC_FIELDS;
  }
  if (deviceType === 'Parlante') {
    return [
      ...PHYSICAL_SIMPLE_FIELDS,
      { key: 'Prende luz', label: 'Prende luz', options: ['Sí', 'No'] },
    ];
  }
  if (deviceType === 'Notebook' || deviceType === 'Consola / joystick') {
    return PHYSICAL_SIMPLE_FIELDS;
  }
  return PHYSICAL_DEFAULT_FIELDS;
}

export function getFunctionalCheckFields(deviceType?: string): CheckFieldOption[] {
  if (deviceType === 'PC de escritorio') {
    return FUNCTIONAL_PC_FIELDS;
  }
  if (deviceType === 'Notebook') {
    return FUNCTIONAL_NOTEBOOK_FIELDS;
  }
  if (deviceType === 'Consola / joystick') {
    return FUNCTIONAL_CONSOLE_FIELDS;
  }
  return FUNCTIONAL_DEFAULT_FIELDS;
}
