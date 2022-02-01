import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";


@Entity()
export default class EntityBase {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;
}