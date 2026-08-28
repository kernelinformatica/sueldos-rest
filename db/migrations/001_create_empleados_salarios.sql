-- Migration: Crear tabla empleados_salarios
CREATE TABLE IF NOT EXISTS empleados_salarios (
  salario_id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  empleado_id INT NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  fecha_desde DATE NOT NULL,
  fecha_hasta DATE DEFAULT NULL,
  razon VARCHAR(255) DEFAULT NULL,
  creado_por INT DEFAULT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_emp_salario_emp (empresa_id, empleado_id),
  FOREIGN KEY (empleado_id) REFERENCES empleados(empleado_id),
  FOREIGN KEY (empresa_id) REFERENCES empresas(empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish_ci;

-- Opcional: poblar con sueldo_basico de convenios_categorias para empleados que no tengan salario
INSERT INTO empleados_salarios (empresa_id, empleado_id, monto, fecha_desde, razon)
SELECT e.empresa_id, e.empleado_id, cc.sueldo_basico, COALESCE(e.fecha_ingreso, CURDATE()), 'Inicial desde convenios_categorias'
FROM empleados e
LEFT JOIN (
  SELECT categoria_id, sueldo_basico FROM convenios_categorias
) cc ON cc.categoria_id = e.convenio_categoria_id
WHERE e.convenio_categoria_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM empleados_salarios es WHERE es.empleado_id = e.empleado_id
  );
