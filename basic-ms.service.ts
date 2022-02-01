import { HttpStatus } from "@nestjs/common";
import { ClassConstructor, classToPlain, instanceToInstance, instanceToPlain, plainToInstance } from "class-transformer";
import { BaseEntity, DeepPartial, LimitOnUpdateNotSupportedError, QueryFailedError, Repository, SelectQueryBuilder } from "typeorm";
import QueryCondition from "./common/ex3-ms-dtos/queryCondition.dto";
import RequestModel from "./common/ex3-ms-dtos/requestModel";
import RequsetModelQuery from "./common/ex3-ms-dtos/requestModelQuery";
import ResponseModel from './common/ex3-ms-dtos/responseModel';
import ResponseModelQueryDto from "./common/ex3-ms-dtos/responseModelQuery.dto";

enum ResponseMessage {
    SUCCESS = 'Successfully processed the request. ',
    FAILED = 'Error occured while interacting with database. '
}


export default class BasicMicroService<TEntity, TDto> {

    private genericRepository: Repository<TEntity>;
    private ralationalMappingFields: Array<string & keyof TDto>;
    private entityClassConstructor: ClassConstructor<TEntity>;
    private entityName: string;
    private responseModelClassConstructor: ClassConstructor<TDto>;
    constructor(
        genericRepository: Repository<TEntity>,
        ralationalMappingFields: Array<string & keyof TDto>,
        entityClassConstructor: ClassConstructor<TEntity>,
        responseModelClassConstructor: ClassConstructor<TDto>,
        entityName: string
    ) {
        this.genericRepository = genericRepository;
        this.ralationalMappingFields = ralationalMappingFields;
        this.entityClassConstructor = entityClassConstructor;
        this.entityName = entityName;
        this.responseModelClassConstructor = responseModelClassConstructor;
    }

    private getMappedObject(data: TDto): DeepPartial<TEntity> {
        for (let key of this.ralationalMappingFields) {
            if (data[key]) {
                let map: any;
                if (Array.isArray(data[key])) {
                    let ids = <unknown>data[key];
                    const idss = <Array<number | string>>ids;
                    map = []
                    for (let id of idss) {
                        map.push({ id });
                    }
                } else {
                    map = { id: data[key] };
                }
                data[key] = map;
            }
        }
        return plainToInstance(this.entityClassConstructor, data);
    }

    async getAll(): Promise<ResponseModel<TDto[]>> {
        try {
            const data: TEntity[] = await this.genericRepository.find();
            return new ResponseModel<TDto[]>(HttpStatus.OK, 'SUCCESS', 'GET', ResponseMessage.SUCCESS, plainToInstance(this.responseModelClassConstructor, data));
        } catch (error) {
            return new ResponseModel<TDto[]>(HttpStatus.INTERNAL_SERVER_ERROR, 'FAILED', 'GET', ResponseMessage.FAILED + error.message, null);
        }
    }

    async getById(id: number | string): Promise<ResponseModel<TDto>> {
        try {
            const data: TEntity = await this.genericRepository.findOneOrFail(id);
            return new ResponseModel<TDto>(HttpStatus.OK, 'SUCCESS', 'GET', ResponseMessage.SUCCESS, plainToInstance(this.responseModelClassConstructor, data));
        } catch (error) {
            return new ResponseModel<TDto>(HttpStatus.INTERNAL_SERVER_ERROR, 'FAILED', 'GET', ResponseMessage.FAILED + error.message, null);
        }
    }

    async create(req: RequestModel<TDto>): Promise<ResponseModel<TDto>> {
        try {
            const body: DeepPartial<TEntity> = this.getMappedObject(req.data);
            const object: TEntity = this.genericRepository.create(body);
            const createdObject: TEntity = await this.genericRepository.save(object);
            const res = new ResponseModel<TDto>(HttpStatus.CREATED, 'SUCCESS', 'POST', ResponseMessage.SUCCESS + `Created ${this.entityName} successfully`, plainToInstance(this.responseModelClassConstructor, createdObject));
            return res
        } catch (error) {
            console.log(error);
            const res = new ResponseModel<TDto>(HttpStatus.INTERNAL_SERVER_ERROR, 'FAILED', 'POST', ResponseMessage.FAILED + error.message, null);
            return res;
        }
    }

    async update(req: RequestModel<TDto>): Promise<ResponseModel<TDto>> {
        try {
            const id = req.data['id'];
            if (id) {
                const object = await this.genericRepository.findOneOrFail(id);
                const body: DeepPartial<TEntity> = this.getMappedObject(req.data);
                const newObject: TEntity = { ...object, ...body };
                const updatedObject: TEntity = await this.genericRepository.save(plainToInstance(this.entityClassConstructor, newObject));
                const res = new ResponseModel<TDto>(HttpStatus.OK, 'SUCCESS', 'PUT', ResponseMessage.SUCCESS + `Updated ${this.entityName} with id: ${id} successfully`, plainToInstance(this.responseModelClassConstructor, updatedObject));
                return res;
            }
            else {
                const res = new ResponseModel<TDto>(HttpStatus.BAD_REQUEST, 'FAILED', 'PUT', ResponseMessage.FAILED + `Unable to find ${this.entityName} with id: ${id}.`, null);
                return res;
            }
        } catch (error) {
            const res = new ResponseModel<TDto>(HttpStatus.INTERNAL_SERVER_ERROR, 'FAILED', 'PUT', ResponseMessage.FAILED + error.message, null);
            return res;
        }
    }

    async delete(id: number | string): Promise<any> {
        try {
            const object: TEntity = await this.genericRepository.findOneOrFail(id);
            const deletedObject: TEntity = await this.genericRepository.remove(object);
            const res = new ResponseModel<TDto>(HttpStatus.OK, 'SUCCESS', 'DELETE', `Deleted ${this.entityName} with id: ${id}`, plainToInstance(this.responseModelClassConstructor, deletedObject));
            return res;
        } catch (error) {
            const res = new ResponseModel<TDto>(HttpStatus.INTERNAL_SERVER_ERROR, 'FAILED', 'DELETE', ResponseMessage.FAILED + error.message, null);
            return res;
        }
    }

    private condtionalQueryBuilder(queryBuilder: SelectQueryBuilder<TEntity>, conditions: QueryCondition[], search: string): SelectQueryBuilder<TEntity> {
        for (let condition of conditions) {
            const columnName = condition.columnName;
            condition.columnType === 'number' ? queryBuilder.orWhere(`object.${columnName}::text LIKE :search`, { search: `%${search}%` }) : queryBuilder.orWhere(`object.${columnName} LIKE :search`, { search: `%${search}%` })
        }
        return queryBuilder;
    }

    private leftJoinChildern(queryBuilder: SelectQueryBuilder<TEntity>, children: string[]): SelectQueryBuilder<TEntity> {
        for (let child of children) {
            queryBuilder
                .leftJoinAndSelect('object.' + child, child);
        }
        return queryBuilder;
    }

    async queryFilter(body: RequsetModelQuery): Promise<ResponseModel<ResponseModelQueryDto<TDto[]>>> {
        const pazeSize = body.filter.page.pageSize;
        const offset = (body.filter.page.pageNumber - 1) * pazeSize;
        const search = body.filter.searchTerm;
        try {
            let queryBuild: SelectQueryBuilder<TEntity> = await this.genericRepository
                .createQueryBuilder('object')
            queryBuild = this.condtionalQueryBuilder(queryBuild, body.filter.conditions, search)
                .orderBy('object.' + body.filter.orderByField, body.filter.orderBy)
            const entityCount: number = await queryBuild.getCount();
            queryBuild
                .offset(offset)
                .limit(pazeSize)
            const data: TEntity[] = await this.leftJoinChildern(queryBuild, body.children)
                .getMany();
            console.log(data, entityCount);
            const responeData: ResponseModelQueryDto<TDto[]> = {
                count: entityCount,
                list: plainToInstance(this.responseModelClassConstructor, data)
            }
            return new ResponseModel<ResponseModelQueryDto<TDto[]>>(HttpStatus.OK, 'SUCCESS', 'GET', ResponseMessage.SUCCESS, responeData);
        } catch (error) {
            console.log(error);
            return new ResponseModel<ResponseModelQueryDto<TDto[]>>(HttpStatus.INTERNAL_SERVER_ERROR, 'FAILED', 'GET', ResponseMessage.FAILED + error.message, null);
        }
    }
}